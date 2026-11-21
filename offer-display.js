/* Offer display for the static site.
 * price-tracker-data scripts/build_site.py writes data JSON only.
 * This file lives in price-tracker-site and is not generated. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.OfferDisplay = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var VERDICTS = { BUY: true, WATCH: true, WAIT: true };
  var RECOVERABLE = { blocked: true, paused: true, stale: true };
  var EXCLUDED = {
    blocked: "Blocked",
    paused: "Paused",
    stale: "Stale",
    age: "Older than 36 hours",
    gone: "Gone",
    out_of_stock: "Out of stock",
    no_price: "No price observed",
    absent: "No Amazon listing",
    inactive: "Inactive",
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function safeUrl(url) {
    try {
      var parsed = new URL(String(url));
      if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.href;
    } catch (err) {
      return "";
    }
    return "";
  }

  function money(value) {
    if (value == null) return null;
    if (typeof value === "string" && value.trim() === "") return null;
    var n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return null;
    return "$" + n.toFixed(2);
  }

  function formatAge(ageHours) {
    if (ageHours == null || ageHours === "") return "age unknown";
    var n = typeof ageHours === "number" ? ageHours : Number(ageHours);
    if (!Number.isFinite(n) || n < 0) return "age unknown";
    var hours = Math.floor(n);
    if (hours < 48) return hours + "h old";
    var days = Math.floor(hours / 24);
    var rem = hours % 24;
    return rem ? days + "d " + rem + "h old" : days + "d old";
  }

  function formatWhen(ts) {
    if (ts == null || ts === "") return "date unknown";
    var text = String(ts);
    return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : "date unknown";
  }

  function day(value) {
    return value ? String(value).slice(0, 10) : "n/a";
  }

  function isAmazonStore(store) {
    if (!store || typeof store !== "object") return false;
    if (String(store.key || "").toLowerCase() === "amazon") return true;
    var href = safeUrl(store.url);
    if (!href) return false;
    var host = new URL(href).hostname.toLowerCase().split(".");
    return host.indexOf("amazon") !== -1;
  }

  function hasOfferPayload(offers) {
    return !!offers && typeof offers === "object" && ("current" in offers || "amazon" in offers);
  }

  function pickOffers(record) {
    if (!record || typeof record !== "object") return null;
    if (hasOfferPayload(record.offers)) return record.offers;
    if (record.verdict && typeof record.verdict === "object" && hasOfferPayload(record.verdict.offers)) {
      return record.verdict.offers;
    }
    return null;
  }

  function verdictName(record) {
    if (!record || typeof record !== "object") return null;
    if (typeof record.verdict === "string") return record.verdict;
    if (record.verdict && typeof record.verdict.verdict === "string") return record.verdict.verdict;
    return null;
  }

  function legacyBest(record) {
    if (!record || typeof record !== "object") return null;
    if (record.best_now && typeof record.best_now === "object") return record.best_now;
    if (record.verdict && typeof record.verdict === "object" && record.verdict.best_now) return record.verdict.best_now;
    return null;
  }

  function pricedPoint(point) {
    if (!point || typeof point !== "object") return null;
    if (point.price_usd == null || point.store == null || point.store === "") return null;
    if (money(point.price_usd) == null) return null;
    return point;
  }

  function resolveView(record) {
    var offers = pickOffers(record);
    var verdict = verdictName(record);
    if (!offers) {
      return { mode: "legacy", current: pricedPoint(legacyBest(record)), amazon: null, verdict: verdict };
    }
    var amazon = offers.amazon && typeof offers.amazon === "object" ? offers.amazon : null;
    return { mode: "offers", current: pricedPoint(offers.current), amazon: amazon, verdict: verdict };
  }

  function anchorBestNow(record) {
    var view = resolveView(record);
    if (view.mode === "legacy") {
      var best = view.current;
      return best ? { price_usd: best.price_usd, store: best.store } : null;
    }
    return view.current ? { price_usd: view.current.price_usd, store: view.current.store } : null;
  }

  function storeLabel(key, stores) {
    var list = Array.isArray(stores) ? stores : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].key === key && list[i].name) return String(list[i].name);
    }
    return key == null ? "" : String(key);
  }

  function statusPresentation(reason) {
    var known = Object.prototype.hasOwnProperty.call(EXCLUDED, reason);
    return {
      label: known ? EXCLUDED[reason] : reason ? String(reason) : "",
      recoverable: !!RECOVERABLE[reason],
    };
  }

  function renderVerdictBadge(verdict, view) {
    if (view && view.mode === "offers" && !view.current && verdict === "BUY") {
      return '<span class="badge stored" data-badge="not-current">BUY not current</span>';
    }
    if (VERDICTS[verdict]) return '<span class="badge ' + verdict + '">' + verdict + "</span>";
    return '<span class="badge WAIT">n/a</span>';
  }

  function renderCurrentBlock(view, options) {
    var current = view.current;
    if (!current) {
      return (
        '<div class="offer current-offer is-empty" data-offer="current">' +
        '<span class="kicker">Current offer</span>' +
        '<span class="price">no current offer</span>' +
        '<span class="muted">No purchasable offer in the fresh window.</span>' +
        "</div>"
      );
    }
    var when = formatWhen(current.ts);
    var age = formatAge(current.age_hours);
    var checked = view.mode === "legacy" ? "" : when + ", " + age;
    var detach = "";
    if (view.verdict === "BUY" && view.amazon && view.amazon.role === "historical") {
      detach = '<span class="not-offer">Stored BUY is not the Amazon price.</span>';
    }
    return (
      '<div class="offer current-offer" data-offer="current">' +
      '<span class="kicker">Current offer</span>' +
      '<span class="price" data-price="' + escapeHtml(money(current.price_usd)) + '">' +
      escapeHtml(money(current.price_usd)) +
      "</span>" +
      '<span class="muted">' +
      escapeHtml(storeLabel(current.store, options.stores)) +
      (checked ? ", " + escapeHtml(checked) : "") +
      "</span>" +
      detach +
      "</div>"
    );
  }

  function renderAmazonBlock(amazon, options) {
    if (!amazon) {
      return (
        '<div class="offer amazon-offer is-none" data-offer="amazon" data-amazon-role="none">' +
        '<span class="kicker">Amazon</span>' +
        '<span class="muted">No Amazon observation in this payload.</span>' +
        "</div>"
      );
    }
    var role = amazon.role === "current" || amazon.role === "historical" || amazon.role === "none" ? amazon.role : "none";
    var last = pricedPoint(amazon.last_success);
    var status = statusPresentation(amazon.excluded_reason);
    var chip = "";
    if (role !== "current" && status.label) {
      chip =
        '<span class="status-chip' +
        (status.recoverable ? " recoverable" : "") +
        '">' +
        escapeHtml(status.label) +
        (status.recoverable ? ", recoverable" : "") +
        "</span>";
    }
    var klass = role === "historical" ? "is-historical" : role === "current" ? "is-current" : "is-none";
    var body = "";
    if (role === "current" && last) {
      var same =
        options.current &&
        options.current.store === last.store &&
        money(options.current.price_usd) === money(last.price_usd);
      body = same
        ? '<span class="kicker">Amazon</span><span class="muted">Amazon is the current offer, ' +
          escapeHtml(formatAge(last.age_hours)) +
          ".</span>"
        : '<span class="kicker">Amazon current offer</span>' +
          '<span class="context-price" data-amazon-price="' +
          escapeHtml(money(last.price_usd)) +
          '">' +
          escapeHtml(money(last.price_usd)) +
          "</span>" +
          '<span class="muted">' +
          escapeHtml(formatWhen(last.ts)) +
          ", " +
          escapeHtml(formatAge(last.age_hours)) +
          "</span>" +
          '<span class="not-offer">Purchasable, not the lowest current offer.</span>';
    } else if (role === "historical" && last) {
      body =
        '<span class="kicker">Last successful Amazon price</span>' +
        '<span class="context-price" data-amazon-price="' +
        escapeHtml(money(last.price_usd)) +
        '">' +
        escapeHtml(money(last.price_usd)) +
        "</span>" +
        '<span class="muted">' +
        escapeHtml(formatWhen(last.ts)) +
        ", " +
        escapeHtml(formatAge(last.age_hours)) +
        "</span>" +
        chip +
        '<span class="not-offer">Not a current offer</span>';
    } else if (last) {
      body =
        '<span class="kicker">Last successful Amazon price</span>' +
        '<span class="context-price" data-amazon-price="' +
        escapeHtml(money(last.price_usd)) +
        '">' +
        escapeHtml(money(last.price_usd)) +
        "</span>" +
        '<span class="muted">' +
        escapeHtml(formatWhen(last.ts)) +
        ", " +
        escapeHtml(formatAge(last.age_hours)) +
        "</span>" +
        chip +
        '<span class="not-offer">Not a current offer</span>';
    } else {
      body =
        '<span class="kicker">Amazon</span>' +
        '<span class="muted">No successful Amazon price.</span>' +
        chip;
    }
    var sentence = "";
    if (!options.compact && typeof amazon.sentence === "string" && amazon.sentence) {
      sentence = '<span class="sentence muted">' + escapeHtml(amazon.sentence) + "</span>";
    }
    return (
      '<div class="offer amazon-offer ' +
      klass +
      '" data-offer="amazon" data-amazon-role="' +
      role +
      '"' +
      (amazon.excluded_reason ? ' data-excluded="' + escapeHtml(amazon.excluded_reason) + '"' : "") +
      ">" +
      body +
      sentence +
      "</div>"
    );
  }

  function renderOfferSplit(view, options) {
    options = options || {};
    if (!view || view.mode !== "offers") return "";
    var compact = !!options.compact;
    var amazonOptions = {
      compact: compact,
      current: view.current,
      stores: options.stores,
    };
    return (
      '<section class="offer-split ' +
      (compact ? "compact" : "detail") +
      '" data-mode="offers" aria-label="Offers">' +
      '<div class="offer-grid">' +
      renderCurrentBlock(view, options) +
      renderAmazonBlock(view.amazon, amazonOptions) +
      "</div></section>"
    );
  }

  function legacyPriceHtml(record) {
    var best = pricedPoint(legacyBest(record));
    if (!best) {
      return '<div class="price">no live price</div><div class="muted">checked ' + escapeHtml(day(record && record.last_checked)) + "</div>";
    }
    return (
      '<div class="price">' +
      escapeHtml(money(best.price_usd)) +
      '</div><div class="muted">' +
      escapeHtml(String(best.store)) +
      ", checked " +
      escapeHtml(day(record && record.last_checked)) +
      "</div>"
    );
  }

  function renderPriceBlock(record, options) {
    var view = resolveView(record);
    if (view.mode === "legacy") return legacyPriceHtml(record);
    return renderOfferSplit(view, Object.assign({ compact: true }, options || {}));
  }

  function storeStatusHtml(store) {
    if (!store || !store.active) return "inactive";
    var status = String(store.status || "");
    var label = escapeHtml(status || "unknown");
    if (isAmazonStore(store) && RECOVERABLE[status]) {
      return label + ' <span class="status-chip recoverable">recoverable</span>';
    }
    return label;
  }

  return {
    escapeHtml: escapeHtml,
    safeUrl: safeUrl,
    money: money,
    formatAge: formatAge,
    formatWhen: formatWhen,
    isAmazonStore: isAmazonStore,
    statusPresentation: statusPresentation,
    resolveView: resolveView,
    anchorBestNow: anchorBestNow,
    renderVerdictBadge: renderVerdictBadge,
    renderOfferSplit: renderOfferSplit,
    renderPriceBlock: renderPriceBlock,
    storeStatusHtml: storeStatusHtml,
  };
});
