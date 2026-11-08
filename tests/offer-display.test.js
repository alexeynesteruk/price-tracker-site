const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const display = require("../offer-display.js");

const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/example-offers.json"), "utf8"));

function extractDiv(html, attr) {
  const start = html.indexOf(attr);
  if (start < 0) return "";
  const open = html.lastIndexOf("<div", start);
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    if (html.startsWith("<div", i)) {
      depth += 1;
      i += 3;
    } else if (html.startsWith("</div>", i)) {
      depth -= 1;
      if (depth === 0) return html.slice(open, i + 6);
    }
  }
  return "";
}

function render(record, compact) {
  const view = display.resolveView(record);
  const html = compact
    ? display.renderPriceBlock(record, { stores: record.stores })
    : display.renderOfferSplit(view, { stores: record.stores, compact: false });
  return { view, html, badge: display.renderVerdictBadge(view.verdict, view) };
}

test("age formatting distinguishes zero, unknown, and multi-day ages", () => {
  assert.equal(display.formatAge(0), "0h old");
  assert.equal(display.formatAge(null), "age unknown");
  assert.equal(display.formatAge(undefined), "age unknown");
  assert.equal(display.formatAge("nope"), "age unknown");
  assert.equal(display.formatAge(-1), "age unknown");
  assert.equal(display.formatAge(40), "40h old");
  assert.equal(display.formatAge(48), "2d old");
  assert.equal(display.formatAge(50), "2d 2h old");
  assert.equal(display.formatWhen(null), "date unknown");
  assert.equal(display.formatWhen("not-a-date"), "date unknown");
  assert.equal(display.formatWhen("2026-09-17T15:00:00Z"), "2026-09-17");
});

test("recoverable status is only blocked, paused, and stale", () => {
  for (const reason of ["blocked", "paused", "stale"]) {
    assert.equal(display.statusPresentation(reason).recoverable, true);
  }
  for (const reason of ["age", "gone", "out_of_stock", "no_price", "absent", "inactive"]) {
    assert.equal(display.statusPresentation(reason).recoverable, false);
  }
  assert.equal(display.statusPresentation("age").label, "Older than 36 hours");
  assert.equal(display.statusPresentation("out_of_stock").label, "Out of stock");
});

test("amazon store detection matches the data repo rule and does not fetch", () => {
  assert.equal(display.isAmazonStore({ key: "amazon", url: "https://example.test/item" }), true);
  assert.equal(display.isAmazonStore({ key: "ace", url: "https://www.amazon.co.uk/dp/B000000000" }), true);
  assert.equal(display.isAmazonStore({ key: "ace", url: "https://notamazon.example.test/item" }), false);
  assert.equal(display.isAmazonStore({ key: "ace", url: "javascript:alert(1)" }), false);
  assert.equal(display.safeUrl("javascript:alert(1)"), "");
  assert.equal(display.safeUrl("https://example.test/item"), "https://example.test/item");
});

test("store status chip marks recoverable Amazon states only", () => {
  const amazon = { key: "amazon", active: true, status: "blocked", url: "https://example.test/amazon" };
  const paused = { key: "amazon", active: true, status: "paused" };
  const stale = { key: "amazon", active: true, status: "stale" };
  const other = { key: "ace", active: true, status: "blocked", url: "https://example.test/ace" };
  const gone = { key: "amazon", active: true, status: "gone" };
  assert.match(display.storeStatusHtml(amazon), /recoverable/);
  assert.match(display.storeStatusHtml(paused), /recoverable/);
  assert.match(display.storeStatusHtml(stale), /recoverable/);
  assert.equal(display.storeStatusHtml(other), "blocked");
  assert.equal(display.storeStatusHtml(gone), "gone");
  assert.equal(display.storeStatusHtml({ key: "amazon", active: false, status: "blocked" }), "inactive");
});

test("fixture examples keep historical Amazon out of the current offer", () => {
  for (const record of fixtures) {
    const exp = record.expect;
    const list = render(record, true);
    const detail = render(record, false);
    assert.equal(list.view.mode, exp.mode, record.id);
    assert.equal(list.badge.includes(exp.badgeClass || exp.badge), true, record.id + " badge");
    const anchor = display.anchorBestNow(record);
    if (exp.anchorStore == null) assert.equal(anchor, null, record.id);
    else {
      assert.equal(anchor.store, exp.anchorStore, record.id);
      assert.equal(anchor.price_usd, exp.anchorPrice == null ? anchor.price_usd : exp.anchorPrice);
    }

    if (exp.mode === "legacy") {
      assert.equal(list.html.includes("data-offer=\"amazon\""), false, record.id);
      assert.equal(list.html.includes("Last successful"), false, record.id);
      assert.match(list.html, new RegExp(exp.legacyPrice.replace("$", "\\$")));
      assert.match(list.html, new RegExp(exp.legacyStore));
      assert.equal(detail.html, "");
      continue;
    }

    for (const html of [list.html, detail.html]) {
      const current = extractDiv(html, 'data-offer="current"');
      const amazon = extractDiv(html, 'data-offer="amazon"');
      assert.notEqual(current, "", record.id + " current");
      assert.notEqual(amazon, "", record.id + " amazon");
      assert.match(amazon, new RegExp(`data-amazon-role="${exp.amazonRole}"`));
      if (exp.currentPrice) {
        assert.match(current, new RegExp(`data-price="${exp.currentPrice.replace("$", "\\$")}"`));
        assert.equal(current.includes("data-amazon-price"), false, record.id);
        assert.equal(current.includes("Not a current offer"), false, record.id);
      } else {
        assert.match(current, /no current offer/);
        assert.equal(current.includes("data-price"), false, record.id);
        assert.equal(current.includes("data-amazon-price"), false, record.id);
      }
      if (exp.amazonPrice) {
        assert.match(amazon, new RegExp(`data-amazon-price="${exp.amazonPrice.replace("$", "\\$")}"`));
        assert.match(amazon, /Not a current offer/);
        assert.equal(amazon.includes('class="price"'), false, record.id);
        assert.equal(amazon.includes("badge BUY"), false, record.id);
      } else {
        assert.equal(amazon.includes("data-amazon-price"), false, record.id);
      }
      if (exp.status) assert.match(amazon, new RegExp(exp.status));
      if (exp.recoverable === false) assert.equal(amazon.includes("recoverable"), false, record.id);
      if (exp.amazonAge) assert.match(amazon, new RegExp(exp.amazonAge));
      if (exp.ageText) assert.match(current, new RegExp(exp.ageText));
      if (exp.dateText) assert.match(html, new RegExp(exp.dateText));
      if (exp.currentStore) assert.match(current, new RegExp(exp.currentStore));
      if (exp.amazonSays) assert.match(amazon, new RegExp(exp.amazonSays.replace(/[.]/g, "\\.")));
      if (exp.badge === "BUY" && exp.amazonRole === "historical" && exp.currentPrice) {
        assert.match(current, /Stored BUY is not the Amazon price/);
        assert.equal(amazon.includes("Stored BUY"), false, record.id);
      }
      assert.equal(html.includes("amazon.com"), false, record.id);
      assert.equal(html.includes("fetch("), false, record.id);
    }
    if (record.offers && record.offers.amazon && record.offers.amazon.sentence) {
      assert.equal(list.html.includes(record.offers.amazon.sentence), false, record.id);
      assert.equal(detail.html.includes(record.offers.amazon.sentence), true, record.id);
      const current = extractDiv(detail.html, 'data-offer="current"');
      assert.equal(current.includes(record.offers.amazon.sentence), false, record.id);
    }
  }
});

test("offers payload wins over a stale best_now, including when nested on the verdict", () => {
  const nested = {
    verdict: {
      verdict: "BUY",
      best_now: { price_usd: 10, store: "amazon" },
      offers: {
        current: { role: "current", store: "bestbuy", price_usd: 80, ts: "2026-09-17T17:00:00Z", age_hours: 0 },
        amazon: {
          role: "historical",
          eligible: false,
          excluded_reason: "blocked",
          last_success: { price_usd: 10, store: "amazon", ts: "2026-09-17T15:00:00Z", age_hours: 2, fresh: true },
          sentence: "Amazon last success $10.00 is historical context, not a current offer (blocked).",
        },
      },
    },
  };
  const anchor = display.anchorBestNow(nested);
  assert.deepEqual(anchor, { price_usd: 80, store: "bestbuy" });
  const html = display.renderPriceBlock(nested);
  const current = extractDiv(html, 'data-offer="current"');
  const amazon = extractDiv(html, 'data-offer="amazon"');
  assert.match(current, /data-price="\$80\.00"/);
  assert.match(amazon, /data-amazon-price="\$10\.00"/);
  assert.match(amazon, /Not a current offer/);
  assert.equal(current.includes("$10.00"), false);
});

test("missing, empty, and hostile fields render as text", () => {
  const hostile = {
    verdict: "BUY",
    offers: {
      current: { role: "current", store: "<img src=x onerror=alert(1)>", price_usd: 40, ts: "2026-09-17T00:00:00Z", age_hours: 1 },
      amazon: {
        role: "historical",
        excluded_reason: "blocked\"><script>",
        last_success: { price_usd: 1, store: "amazon", ts: "2026-09-17T00:00:00Z", age_hours: 1 },
        sentence: "<img src=x onerror=alert(1)>",
      },
    },
  };
  const html = display.renderOfferSplit(display.resolveView(hostile), { compact: false });
  assert.equal(html.includes("<img"), false);
  assert.equal(html.includes("<script>"), false);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.equal(display.money("abc"), null);
  assert.equal(display.money(null), null);
  const broken = display.renderPriceBlock({
    verdict: "WAIT",
    offers: { current: { store: "", price_usd: "nope" }, amazon: { role: "historical", last_success: "nope" } },
  });
  assert.match(broken, /no current offer/);
  assert.match(broken, /No successful Amazon price/);
  assert.equal(display.renderPriceBlock(null), '<div class="price">no live price</div><div class="muted">checked n/a</div>');
});

test("an absent Amazon listing does not invent a price", () => {
  const html = display.renderPriceBlock({
    verdict: "WAIT",
    best_now: { price_usd: 5, store: "amazon" },
    offers: { current: null, amazon: { role: "none", eligible: false, excluded_reason: "absent", last_success: null, sentence: null } },
  });
  assert.match(html, /no current offer/);
  assert.match(html, /No Amazon listing/);
  assert.equal(html.includes("data-price"), false);
  assert.equal(html.includes("data-amazon-price"), false);
  assert.equal(html.includes("$5.00"), false);
  assert.equal(display.renderVerdictBadge("BUY", display.resolveView({
    verdict: "BUY",
    offers: { current: null, amazon: { role: "none", last_success: null } },
  })).includes("badge BUY"), false);
});

test("a cheaper fresh Amazon offer stays purchasable when it is current", () => {
  const record = {
    verdict: "BUY",
    offers: {
      current: { role: "current", store: "amazon", price_usd: 10, ts: "2026-09-17T16:00:00Z", age_hours: 1 },
      amazon: {
        role: "current",
        eligible: true,
        excluded_reason: null,
        last_success: { price_usd: 10, store: "amazon", ts: "2026-09-17T16:00:00Z", age_hours: 1, fresh: true },
        sentence: null,
      },
    },
  };
  const html = display.renderPriceBlock(record);
  const current = extractDiv(html, 'data-offer="current"');
  const amazon = extractDiv(html, 'data-offer="amazon"');
  assert.match(current, /data-price="\$10\.00"/);
  assert.match(amazon, /data-amazon-role="current"/);
  assert.match(amazon, /Amazon is the current offer, 1h old/);
  assert.equal(amazon.includes("Not a current offer"), false);
  assert.match(display.renderVerdictBadge("BUY", display.resolveView(record)), /class="badge BUY"/);
});

test("an eligible Amazon price that is not the lowest stays visible beside the other store", () => {
  const html = display.renderPriceBlock({
    verdict: "WAIT",
    offers: {
      current: { role: "current", store: "bestbuy", price_usd: 50, ts: "2026-09-17T17:00:00Z", age_hours: 1 },
      amazon: {
        role: "current",
        eligible: true,
        excluded_reason: null,
        last_success: { price_usd: 60, store: "amazon", ts: "2026-09-17T16:00:00Z", age_hours: 2, fresh: true },
        sentence: null,
      },
    },
  });
  const current = extractDiv(html, 'data-offer="current"');
  const amazon = extractDiv(html, 'data-offer="amazon"');
  assert.match(current, /data-price="\$50\.00"/);
  assert.match(amazon, /data-amazon-price="\$60\.00"/);
  assert.match(amazon, /Purchasable, not the lowest current offer/);
  assert.equal(amazon.includes("Not a current offer"), false);
  assert.equal(current.includes("$60.00"), false);
});

test("example fixture file is not wired into the catalog index", () => {
  const index = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/index.json"), "utf8"));
  const ids = new Set(index.items.map((item) => item.id));
  for (const record of fixtures) {
    assert.equal(record.example, true);
    assert.equal(ids.has(record.id), false);
  }
  const catalog = fs.readdirSync(path.join(__dirname, "../data/items"));
  for (const record of fixtures) assert.equal(catalog.includes(record.id + ".json"), false);
});
