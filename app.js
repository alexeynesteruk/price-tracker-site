const DATA_REPO = "alexeynesteruk/price-tracker-data";
const $ = (sel) => document.querySelector(sel);
const usd = (n) => (n == null || !Number.isFinite(Number(n)) ? "n/a" : "$" + Number(n).toFixed(2));
const day = (s) => (s ? String(s).slice(0, 10) : "n/a");
const esc = (s) => OfferDisplay.escapeHtml(s);
const PERIODS = { "30d": 30, "90d": 90, "1y": 365, all: null };

let indexCache = null;
let chart = null;

async function getIndex() {
  if (!indexCache) indexCache = await (await fetch("data/index.json", { cache: "no-store" })).json();
  return indexCache;
}

function issueLink(template, params) {
  const q = new URLSearchParams({ template, ...params }).toString();
  return `https://github.com/${DATA_REPO}/issues/new?${q}`;
}

function hostLabel(url) {
  const href = OfferDisplay.safeUrl(url);
  if (!href) return "";
  try {
    return new URL(href).hostname;
  } catch (err) {
    return "";
  }
}

async function renderList(tab = "active", owner = "") {
  const idx = await getIndex();
  $("#generated").textContent = "updated " + idx.generated.replace("T", " ").replace("Z", " UTC");
  const owners = [...new Set(idx.items.map((i) => i.owner))].sort();
  const items = idx.items.filter((i) => i.state === tab && (!owner || i.owner === owner));
  $("#app").innerHTML = `
    <div class="tabs">${["active", "bought", "paused"]
      .map((t) => `<button data-tab="${t}" class="${t === tab ? "on" : ""}">${t} (${idx.items.filter((i) => i.state === t).length})</button>`)
      .join("")}</div>
    <div class="filters"><button data-owner="" class="${owner ? "" : "on"}">everyone</button>${owners
      .map((o) => `<button data-owner="${esc(o)}" class="${o === owner ? "on" : ""}">${esc(o)}</button>`)
      .join("")}
      <a class="btn" href="${issueLink("track.yml", {})}" target="_blank" rel="noopener">+ Track item</a></div>
    <div class="grid">${
      items
        .map((i) => {
          const view = OfferDisplay.resolveView(i);
          return `
      <a class="card" href="#/items/${esc(i.id)}">
        <div class="row">${OfferDisplay.renderVerdictBadge(view.verdict, view)} <span class="muted">${esc(i.confidence || "")}</span></div>
        <div style="margin:6px 0"><b>${esc(i.title)}</b></div>
        ${
          i.state === "bought" && i.bought
            ? `<div class="price">paid ${usd(i.bought.price_usd)}</div><div class="muted">${esc(i.bought.store)}, ${esc(i.bought.date)}</div>`
            : OfferDisplay.renderPriceBlock(i)
        }
        <div class="muted">${esc(i.owner)}</div>
      </a>`;
        })
        .join("") || `<p class="muted">Nothing here.</p>`
    }</div>`;
  document.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => renderList(b.dataset.tab, owner)));
  document.querySelectorAll("[data-owner]").forEach((b) => (b.onclick = () => renderList(tab, b.dataset.owner)));
}

function anchorsHtml(v, page) {
  if (!v) return "";
  const record = page || { verdict: v };
  const view = OfferDisplay.resolveView(record);
  const best = OfferDisplay.anchorBestNow(record);
  const bestLabel = view.mode === "offers" ? "Current offer" : "Best now";
  const cells = [
    [bestLabel, best ? `${usd(best.price_usd)} <span class="muted">${esc(best.store)}</span>` : "none"],
    ["Typical", v && v.typical != null ? `${usd(v.typical)} <span class="muted">${esc(v.typical_label || "")}</span>` : "absent"],
    ["Good sale (p25)", v && v.good_sale != null ? `${usd(v.good_sale)} <span class="muted">n=${esc(v.n_events)}</span>` : "absent"],
    ["Floor", v && v.floor ? `${usd(v.floor.price_usd)} <span class="muted">${esc(v.floor.date)}</span>` : "absent"],
    [
      "Window",
      v && v.window
        ? `month ${esc(v.window.months[0])}: ${usd(v.window.expect_low)}-${usd(v.window.expect_high)}`
        : esc((v && v.window_note) || "none"),
    ],
  ];
  return `<div class="anchors">${cells.map(([k, val]) => `<div class="anchor"><b>${k}</b>${val}</div>`).join("")}</div>`;
}

function drawChart(page, period, hiddenStores) {
  const days = PERIODS[period];
  const cutoff = days ? Date.now() - days * 86400e3 : 0;
  // out-of-stock rows are recorded with a null price; they have nothing to plot
  const rows = page.history.filter((r) => !r.suspect && r.price_usd != null && new Date(r.ts).getTime() >= cutoff);
  const stores = [...new Set(rows.map((r) => r.store))];
  const palette = ["#1f77b4", "#d62728", "#2ca02c", "#9467bd", "#ff7f0e", "#17becf", "#8c564b", "#e377c2", "#7f7f7f"];
  const datasets = stores.map((s, i) => {
    // Live polls mean "this price held until the next poll", so a stepped line is honest.
    // Seed rows are isolated points in time (a camel lowest-ever, a dated deal event);
    // joining them would draw a trajectory that was never observed.
    const isSeed = rows.find((r) => r.store === s).kind === "seed";
    return {
      label: s,
      data: rows
        .filter((r) => r.store === s)
        .map((r) => ({ x: new Date(r.ts).getTime(), y: r.price_usd, promo: r.promo, kind: r.kind }))
        .sort((a, b) => a.x - b.x),
      borderColor: palette[i % palette.length],
      backgroundColor: palette[i % palette.length],
      showLine: !isSeed,
      hidden: hiddenStores.has(s),
      stepped: !isSeed,
      pointRadius: isSeed ? 4 : 3,
      pointStyle: isSeed ? "circle" : "rect",
      tension: 0,
    };
  });
  const lines = [];
  const v = page.verdict || {};
  if (v.good_sale != null) lines.push({ y: v.good_sale, label: "good sale", color: "#1a7f37" });
  if (v.typical != null) lines.push({ y: v.typical, label: "typical", color: "#6e7781" });
  if (chart) chart.destroy();
  chart = new Chart($("#chart"), {
    type: "line",
    data: { datasets },
    options: {
      maintainAspectRatio: false,
      scales: {
        x: { type: "time", time: { unit: days && days <= 90 ? "day" : "month" } },
        y: { ticks: { callback: (val) => "$" + val } },
      },
      plugins: {
        legend: {
          onClick: (e, legendItem) => {
            const s = legendItem.text;
            hiddenStores.has(s) ? hiddenStores.delete(s) : hiddenStores.add(s);
            drawChart(page, period, hiddenStores);
          },
        },
        tooltip: {
          callbacks: {
            label: (c) =>
              `${c.dataset.label}: ${usd(c.raw.y)}${c.raw.promo ? " (" + c.raw.promo + ")" : ""}${c.raw.kind === "seed" ? " seed" : ""}`,
          },
        },
      },
    },
    plugins: [
      {
        id: "anchorLines",
        afterDraw(c) {
          const { ctx, chartArea, scales } = c;
          lines.forEach((l) => {
            const y = scales.y.getPixelForValue(l.y);
            if (y < chartArea.top || y > chartArea.bottom) return;
            ctx.save();
            ctx.strokeStyle = l.color;
            ctx.setLineDash([2, 4]);
            ctx.beginPath();
            ctx.moveTo(chartArea.left, y);
            ctx.lineTo(chartArea.right, y);
            ctx.stroke();
            ctx.fillStyle = l.color;
            ctx.font = "11px sans-serif";
            ctx.fillText(`${l.label} ${usd(l.y)}`, chartArea.left + 4, y - 3);
            ctx.restore();
          });
        },
      },
    ],
  });
}

async function renderItem(id) {
  const res = await fetch(`data/items/${id}.json`, { cache: "no-store" });
  if (!res.ok) {
    $("#app").innerHTML = `<p>Item <code>${esc(id)}</code> not found.</p>`;
    return;
  }
  const page = await res.json();
  const it = page.item;
  const v = page.verdict;
  const view = OfferDisplay.resolveView(page);
  const state = { period: "1y", hidden: new Set() };
  const recent = page.history.filter(
    (r) => !r.suspect && r.price_usd != null && Date.now() - new Date(r.ts) < 365 * 86400e3
  );
  const low12 = recent.length ? Math.min(...recent.map((r) => r.price_usd)) : null;
  const best = OfferDisplay.anchorBestNow(page);
  const bestStore = best ? it.stores.find((s) => s.key === best.store) : null;
  const offerSection = view.mode === "offers" ? OfferDisplay.renderOfferSplit(view, { stores: it.stores }) : "";
  $("#app").innerHTML = `
    <p><a href="#/">&larr; all items</a></p>
    <div class="row"><h2 style="margin:0">${esc(it.title)}</h2>${OfferDisplay.renderVerdictBadge(view.verdict, view)}<span class="muted">${esc(v ? v.confidence : "")}</span></div>
    <p class="muted">${esc(it.category)}, owner ${esc(it.owner)}, <a href="https://github.com/${DATA_REPO}/issues/${encodeURIComponent(it.issue)}" target="_blank" rel="noopener">issue #${esc(it.issue)}</a>, state ${esc(it.state)}</p>
    ${
      it.state === "bought" && it.bought
        ? `<div class="card"><b>Bought</b>: paid ${usd(it.bought.price_usd)} at ${esc(it.bought.store)} on ${esc(it.bought.date)}. 12-month low on record: ${low12 != null ? usd(low12) : "n/a"}.</div>`
        : ""
    }
    ${offerSection}
    ${anchorsHtml(v, page)}
    ${v ? `<p>${esc(v.reason)}</p>` : "<p class='muted'>No verdict yet.</p>"}
    <div class="filters">${Object.keys(PERIODS)
      .map((p) => `<button data-period="${p}" class="${p === state.period ? "on" : ""}">${p}</button>`)
      .join("")}
      <span class="muted">click a legend entry to hide or show a store</span></div>
    <div class="chart"><canvas id="chart"></canvas></div>
    <div class="table-wrap"><table><thead><tr><th>Store</th><th>Status</th><th>Last ok</th><th>Fails</th><th></th></tr></thead><tbody>
      ${it.stores
        .map((s) => {
          const href = OfferDisplay.safeUrl(s.url);
          const open = href ? `<a href="${esc(href)}" target="_blank" rel="noopener">open</a>` : "";
          return `<tr><td>${esc(s.name)} <span class="muted">${esc(s.key)}</span></td><td>${OfferDisplay.storeStatusHtml(s)}</td><td>${esc(day(s.last_ok))}</td><td>${esc(s.fails)}</td><td>${open}</td></tr>`;
        })
        .join("")}
    </tbody></table></div>
    ${
      it.reviews
        ? `<div class="card"><b>Reviews</b><p>${esc(it.reviews.summary)}</p><p><b>Pros</b>: ${(it.reviews.pros || []).map(esc).join(", ")}. <b>Cons</b>: ${(it.reviews.cons || []).map(esc).join(", ")}.</p><p class="muted">${(it.reviews.sources || [])
            .map((u) => {
              const href = OfferDisplay.safeUrl(u);
              const host = hostLabel(u);
              return href && host ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(host)}</a>` : "";
            })
            .filter(Boolean)
            .join(", ")}</p></div>`
        : ""
    }
    <div class="row" style="margin-top:16px">
      ${
        it.state === "active"
          ? `<a class="btn" target="_blank" rel="noopener" href="${issueLink("bought.yml", {
              item_id: it.id,
              currency: (bestStore && bestStore.currency) || "USD",
              store: best ? best.store : "",
            })}">Bought</a>`
          : ""
      }
      ${
        it.state !== "active" || it.stores.some((s) => s.status === "gone")
          ? `<a class="btn" target="_blank" rel="noopener" href="${issueLink("resume.yml", { item_id: it.id })}">Resume tracking</a>`
          : ""
      }
    </div>`;
  drawChart(page, state.period, state.hidden);
  document.querySelectorAll("[data-period]").forEach(
    (b) =>
      (b.onclick = () => {
        state.period = b.dataset.period;
        document.querySelectorAll("[data-period]").forEach((x) => x.classList.toggle("on", x === b));
        drawChart(page, state.period, state.hidden);
      })
  );
}

function route() {
  const m = location.hash.match(/^#\/items\/([a-z0-9-]+)$/);
  if (m) renderItem(m[1]);
  else renderList();
}
addEventListener("hashchange", route);
route();
