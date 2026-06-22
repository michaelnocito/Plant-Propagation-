const $ = (id) => document.getElementById(id);
const pick = $("pick"), status = $("status"), card = $("card"), chip = $("chip"), picker = $("picker");

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const CATS = [
  ["houseplants", "Houseplants"], ["propagating", "Propagating"],
  ["outdoor", "Outdoor"], ["for_sale", "For Sale"], ["wishlist", "Wishlist"],
];
const catLabel = (v) => (CATS.find((c) => c[0] === v) || [v, v])[1];

let members = [];
let me = null;
let activeTab = "identify";
let currentResult = null;   // the PropResult being shown
let currentSaved = null;    // PlantOut if this result is a saved plant, else null
let lastThumb = "";         // small base64 thumb of the just-taken photo
let lastPhotoData = "";     // ~1024px data URI of the just-taken photo (seeds the gallery on save)
let mineRows = [], familyRows = [];
const filterState = { mine: "all", family: "all" };

const memberBy = (slug) => members.find((m) => m.slug === slug) || { display_name: slug || "?", color: "#7fa07a", slug };
const isMember = (slug) => members.some((m) => m.slug === slug);

/* ---------- identity ---------- */
function renderChip() {
  const m = memberBy(me);
  chip.textContent = (m.display_name[0] || "?").toUpperCase();
  chip.style.background = m.color;
}
function showPicker() {
  $("who-cards").innerHTML = members
    .map((m) => `<div class="who-card" data-slug="${m.slug}">
      <div class="av" style="background:${m.color}">${esc((m.display_name[0] || "?").toUpperCase())}</div>
      <span>${esc(m.display_name)}</span></div>`)
    .join("");
  $("who-cards").querySelectorAll(".who-card").forEach((el) => (el.onclick = () => setMe(el.dataset.slug)));
  picker.classList.add("on");
}
function setMe(slug) {
  me = slug;
  localStorage.setItem("rootwork_user", slug);
  renderChip();
  picker.classList.remove("on");
  if (activeTab === "mine") loadMine();
  if (currentResult) renderSavebar();
}

/* ---------- tabs ---------- */
function showTab(name) {
  activeTab = name;
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("on", v.id === "view-" + name));
  document.querySelectorAll("nav.tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  if (name === "mine") loadMine();
  if (name === "family") loadFamily();
  if (name === "market") loadMarket();
  if (name === "soil") loadSoil();
}

/* ---------- identify ---------- */
pick.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  card.style.display = "none";
  status.className = "status";
  status.textContent = "Reading photo…";
  const blob = await compress(file);
  lastThumb = await thumbDataURL(file);
  lastPhotoData = await blobToDataURL(blob);
  $("thumb").src = URL.createObjectURL(blob);
  $("thumb").style.display = "block";
  status.textContent = "Identifying & assessing…";
  try {
    const fd = new FormData();
    fd.append("file", blob, "plant.jpg");
    const r = await fetch("/propagate", { method: "POST", body: fd });
    if (!r.ok) throw new Error((await r.json()).detail || r.statusText);
    showResult(await r.json(), null, "");
    status.textContent = "";
  } catch (err) {
    status.className = "status err";
    status.textContent = "Couldn't analyze that — try a clearer, closer shot.";
  }
});

async function compress(file) {
  const img = await createImageBitmap(file);
  const max = 1024, s = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * s);
  c.height = Math.round(img.height * s);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, "image/jpeg", 0.8));
}
async function thumbDataURL(file) {
  const img = await createImageBitmap(file);
  const max = 160, s = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * s);
  c.height = Math.round(img.height * s);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.7);
}
function blobToDataURL(blob) {
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.readAsDataURL(blob);
  });
}

/* ---------- result + save bar ---------- */
function showResult(d, saved, thumb) {
  currentResult = d;
  currentSaved = saved;
  render(d);
  if (thumb) {
    $("thumb").src = thumb;
    $("thumb").style.display = "block";
  } else if (saved) {
    $("thumb").style.display = "none";
  }
  renderSavebar();
  renderPhotos();
  showTab("identify");
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderSavebar() {
  const bar = $("savebar");
  if (!currentSaved) {
    bar.innerHTML =
      `<button class="savebtn" id="saveBtn">＋ Save to My Plants</button>` +
      `<button class="savebtn alt" id="saveMktBtn">＋ Save &amp; list on Marketplace</button>`;
    $("saveBtn").onclick = () => doSave(false);
    $("saveMktBtn").onclick = () => doSave(true);
    return;
  }
  const p = currentSaved;
  const m = memberBy(p.owner);
  const mine = p.owner === me;
  if (!mine) {
    bar.innerHTML = `<div class="savedrow"><div class="who">Saved by <b>${esc(m.display_name)}</b>${
      p.nickname ? ` · “${esc(p.nickname)}”` : ""
    }</div><div class="pickline"><span class="cat" style="color:var(--copper);border-color:#ddd2b6">${catLabel(
      p.category
    )}</span></div></div>`;
    return;
  }
  const opts = CATS.map(([v, l]) => `<option value="${v}" ${p.category === v ? "selected" : ""}>${l}</option>`).join("");
  bar.innerHTML = `<div class="savedrow">
    <div class="who">In <b>${esc(m.display_name)}’s</b> plants</div>
    <div class="seg" id="visSeg">
      <button data-v="private" class="${p.visibility === "private" ? "on" : ""}">Private</button>
      <button data-v="family" class="${p.visibility === "family" ? "on" : ""}">Family</button>
    </div>
    <div class="pickline"><label>Category</label><select id="catSel">${opts}</select></div>
    <input class="nick" id="nickInp" placeholder="Add a nickname (optional)" value="${esc(p.nickname)}" />
    <button class="mktbtn ${p.in_market ? "on" : ""}" id="mktBtn">${
      p.in_market ? "✓ Listed on Marketplace" : "＋ List on Marketplace"
    }</button>
    <div class="manage">
      <div class="mline">
        <span>🌱 Propagations rooting</span>
        <span class="stepper"><button id="propMinus" aria-label="fewer">−</button><b id="propN">${p.props_in_progress}</b><button id="propPlus" aria-label="more">+</button></span>
      </div>
      <div class="mline2">
        <button class="mgbtn ${p.sold ? "on" : ""}" id="soldBtn">${p.sold ? "↩ Mark available" : "✓ Mark as sold"}</button>
      </div>
    </div>
    <button class="delbtn" id="delBtn">Remove from my plants</button>
  </div>`;
  $("visSeg").querySelectorAll("button").forEach((b) => (b.onclick = () => patch({ visibility: b.dataset.v })));
  $("catSel").onchange = (e) => patch({ category: e.target.value }, false);
  $("nickInp").onblur = (e) => patch({ nickname: e.target.value }, false);
  $("mktBtn").onclick = () => patch({ in_market: !currentSaved.in_market });
  $("soldBtn").onclick = () => patch({ sold: !currentSaved.sold });
  $("propMinus").onclick = () => stepProps(-1);
  $("propPlus").onclick = () => stepProps(1);
  $("delBtn").onclick = doDelete;
}

async function doSave(inMarket) {
  if (!me) return showPicker();
  const btns = [$("saveBtn"), $("saveMktBtn")].filter(Boolean);
  const btn = inMarket ? $("saveMktBtn") : $("saveBtn");
  btns.forEach((b) => (b.disabled = true));
  if (btn) btn.textContent = "Saving…";
  try {
    const r = await fetch("/plants", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User": me },
      body: JSON.stringify({
        visibility: "private",
        category: "houseplants",
        nickname: "",
        species: currentResult.species,
        common_name: currentResult.common_name,
        ai_result: currentResult,
        thumbnail: lastThumb || "",
        in_market: !!inMarket,
      }),
    });
    if (!r.ok) throw new Error();
    currentSaved = await r.json();
    // seed the gallery with the photo just identified
    if (lastPhotoData) {
      try {
        await fetch(`/plants/${currentSaved.id}/photos`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-User": me },
          body: JSON.stringify({ data: lastPhotoData, thumb: lastThumb || lastPhotoData, caption: "" }),
        });
      } catch (e) { /* non-fatal */ }
    }
    renderSavebar();
    renderPhotos();
  } catch (e) {
    btns.forEach((b) => (b.disabled = false));
    if (btn) btn.textContent = "Save failed — tap to retry";
  }
}

async function patch(fields, rerender = true) {
  try {
    const r = await fetch("/plants/" + currentSaved.id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-User": me },
      body: JSON.stringify(fields),
    });
    if (r.ok) {
      currentSaved = await r.json();
      if (rerender) renderSavebar();
    }
  } catch (e) { /* keep UI as-is */ }
}

async function stepProps(delta) {
  const n = Math.max(0, (currentSaved.props_in_progress || 0) + delta);
  $("propN").textContent = n; // optimistic
  await patch({ props_in_progress: n }, false);
}

/* ---------- photo gallery ---------- */
async function renderPhotos() {
  const sec = $("photos-sec"), box = $("photos");
  if (!currentSaved) {
    sec.style.display = "none";
    return;
  }
  sec.style.display = "block";
  const mine = currentSaved.owner === me;
  let photos = [];
  try {
    photos = await (await fetch(`/plants/${currentSaved.id}/photos`)).json();
  } catch (e) { /* empty */ }
  const tiles = photos
    .map(
      (ph) => `<div class="gphoto" data-id="${ph.id}">
        <img src="${ph.thumb}" alt="${esc(ph.caption)}">
        ${ph.is_cover ? `<span class="cv">Cover</span>` : ""}
      </div>`
    )
    .join("");
  const add = mine ? `<div class="gadd" id="galAdd"><div><span>＋</span>Add photo</div></div>` : "";
  let html = `<div class="gal">${tiles}${add}</div>`;
  if (!photos.length && !mine) html += `<div class="galempty">No photos yet.</div>`;
  if (photos.length) {
    const q = mine ? `scope=plant&id=${currentSaved.id}` : `scope=plant&id=${currentSaved.id}`;
    html += `<div class="galtools"><a href="/export?${q}">⤓ Download all (${photos.length}) as zip</a></div>`;
  }
  box.innerHTML = html;
  box._photos = photos;
  if ($("galAdd")) $("galAdd").onclick = () => $("galleryInput").click();
  box.querySelectorAll(".gphoto").forEach((el) => (el.onclick = () => openLightbox(photos.find((p) => p.id == el.dataset.id), mine)));
}

async function addGalleryPhotos(files) {
  if (!currentSaved || !files.length) return;
  const box = $("photos");
  box.insertAdjacentHTML("afterbegin", `<div class="galempty" id="upMsg">Uploading ${files.length} photo(s)…</div>`);
  for (const file of files) {
    try {
      const blob = await compress(file);
      const data = await blobToDataURL(blob);
      const thumb = await thumbDataURL(file);
      await fetch(`/plants/${currentSaved.id}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-User": me },
        body: JSON.stringify({ data, thumb, caption: "" }),
      });
    } catch (e) { /* skip bad file */ }
  }
  await renderPhotos();
}

function openLightbox(ph, mine) {
  if (!ph) return;
  const lb = $("lightbox");
  $("lbImg").src = `/photos/${ph.id}/full`;
  $("lbCaption").textContent = ph.caption || "";
  const acts = [];
  acts.push(`<a href="/photos/${ph.id}/full" target="_blank" rel="noopener">Open / Save</a>`);
  if (mine) {
    if (!ph.is_cover) acts.push(`<button data-a="cover">Set as cover</button>`);
    acts.push(`<button data-a="caption">Edit caption</button>`);
    acts.push(`<button data-a="delete" class="danger">Delete</button>`);
  }
  $("lbActions").innerHTML = acts.join("");
  $("lbActions").querySelectorAll("button").forEach((b) => (b.onclick = () => lbAction(b.dataset.a, ph)));
  lb.classList.add("on");
}
function closeLightbox() {
  $("lightbox").classList.remove("on");
  $("lbImg").src = "";
}
async function lbAction(a, ph) {
  if (a === "cover") {
    await fetch(`/photos/${ph.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", "X-User": me }, body: JSON.stringify({ is_cover: true }) });
  } else if (a === "caption") {
    const cap = prompt("Caption for this photo:", ph.caption || "");
    if (cap === null) return;
    await fetch(`/photos/${ph.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", "X-User": me }, body: JSON.stringify({ caption: cap }) });
  } else if (a === "delete") {
    if (!confirm("Delete this photo?")) return;
    await fetch(`/photos/${ph.id}`, { method: "DELETE", headers: { "X-User": me } });
  }
  closeLightbox();
  await renderPhotos();
}

function exportPhotos(scope) {
  const q = scope === "mine" ? `scope=mine&user=${encodeURIComponent(me || "")}` : `scope=${scope}`;
  window.location.href = `/export?${q}`;
}

async function doDelete() {
  if (!confirm("Remove this plant from your collection?")) return;
  await fetch("/plants/" + currentSaved.id, { method: "DELETE", headers: { "X-User": me } });
  currentSaved = null;
  $("thumb").style.display = "none";
  card.style.display = "none";
  showTab("mine");
}

/* ---------- collections ---------- */
async function loadMine() {
  if (!me) return showPicker();
  const grid = $("mine-grid");
  grid.innerHTML = `<div class="empty" style="grid-column:1/-1">Loading…</div>`;
  try {
    mineRows = await (await fetch("/plants/mine", { headers: { "X-User": me } })).json();
  } catch (e) { mineRows = []; }
  drawCollection("mine", mineRows);
}
async function loadFamily() {
  const grid = $("family-grid");
  grid.innerHTML = `<div class="empty" style="grid-column:1/-1">Loading…</div>`;
  try {
    familyRows = await (await fetch("/plants/family")).json();
  } catch (e) { familyRows = []; }
  drawCollection("family", familyRows);
}

function drawCollection(view, rows) {
  const grid = $(view + "-grid"), filt = $(view + "-filters");
  const present = CATS.map((c) => c[0]).filter((c) => rows.some((r) => r.category === c));
  const cats = ["all", ...present];
  if (!present.length) filterState[view] = "all";
  filt.innerHTML = cats
    .map((c) => `<button data-c="${c}" class="${filterState[view] === c ? "on" : ""}">${c === "all" ? "All" : catLabel(c)}</button>`)
    .join("");
  filt.querySelectorAll("button").forEach((b) => (b.onclick = () => { filterState[view] = b.dataset.c; drawCollection(view, rows); }));

  const shown = rows.filter((r) => filterState[view] === "all" || r.category === filterState[view]);
  if (!shown.length) {
    grid.innerHTML = emptyState(
      view === "mine"
        ? "No saved plants yet.<br>Identify a plant and tap <b>Save</b>."
        : "Nothing shared yet.<br>Save a plant as <b>Family</b> to add it here."
    );
    return;
  }
  grid.innerHTML = shown.map(pcard).join("");
  grid.querySelectorAll(".pcard").forEach((el, i) => (el.onclick = () => showResult(shown[i].ai_result, shown[i], shown[i].thumbnail)));
}

function pcard(p) {
  const m = memberBy(p.owner);
  const img = p.thumbnail ? `<img class="ph" src="${p.thumbnail}" alt="">` : `<div class="noph">🪴</div>`;
  const title = p.nickname || p.common_name || p.species;
  const sub = p.nickname ? p.common_name || p.species : p.species;
  return `<div class="pcard">${img}<div class="body">
    <div class="nm">${esc(title)}</div>
    <div class="sp">${esc(sub)}</div>
    <div class="meta">
      <span class="own" style="background:${m.color}" title="${esc(m.display_name)}">${esc((m.display_name[0] || "?").toUpperCase())}</span>
      <span class="cat">${catLabel(p.category)}</span>
      ${p.visibility === "family" ? `<span class="cat">Family</span>` : ""}
      ${p.in_market ? `<span class="mkt">Market</span>` : ""}
    </div></div></div>`;
}

/* ---------- marketplace ---------- */
let marketRows = [];
let marketSort = "opp";
let showSold = false;
const EASE = { easy: 1, moderate: 0.6, hard: 0.35 };
const MSORTS = [["opp", "Best bets"], ["prop", "Cuttings $"], ["plant", "Whole-plant $"], ["easy", "Easiest"]];

function parsePrice(str) {
  const nums = String(str || "").replace(/,/g, "").match(/\d+(\.\d+)?/g);
  return nums ? Math.max(...nums.map(Number)) : 0;
}
function parseRange(str) {
  const nums = (String(str || "").replace(/,/g, "").match(/\d+(\.\d+)?/g) || []).map(Number);
  if (!nums.length) return [0, 0];
  return [Math.min(...nums), Math.max(...nums)];
}
function metrics(p) {
  const a = p.ai_result || {};
  const m = a.marketability || {};
  const e = a.established || null;
  const propScore = m.score || 0;
  const estScore = e ? e.score || 0 : 0;
  const ease = EASE[(m.propagation_ease || "").toLowerCase()] ?? 0.6;
  const opp = Math.round(Math.max(propScore, estScore) * ease * 10) / 10; // 0–10: value × easiness
  return { m, e, propScore, estScore, ease, opp, propPrice: parsePrice(m.est_price_range), estPrice: e ? parsePrice(e.est_price_range) : 0 };
}

async function loadMarket() {
  const list = $("market-list");
  list.innerHTML = `<div class="empty">Loading…</div>`;
  try {
    marketRows = await (await fetch("/plants/market")).json();
  } catch (e) {
    marketRows = [];
  }
  drawMarket();
}

function drawMarket() {
  const sortEl = $("market-sort"), list = $("market-list");
  const soldCount = marketRows.filter((p) => p.sold).length;
  sortEl.innerHTML =
    MSORTS.map(([k, l]) => `<button data-s="${k}" class="${marketSort === k ? "on" : ""}">${l}</button>`).join("") +
    `<button data-toggle="sold" class="${showSold ? "on" : ""}">${showSold ? "Hide sold" : `Show sold${soldCount ? ` (${soldCount})` : ""}`}</button>`;
  sortEl.querySelectorAll("button[data-s]").forEach((b) => (b.onclick = () => { marketSort = b.dataset.s; drawMarket(); }));
  const tog = sortEl.querySelector("button[data-toggle]");
  if (tog) tog.onclick = () => { showSold = !showSold; drawMarket(); };

  if (!marketRows.length) {
    list.innerHTML = emptyState("Nothing listed yet.<br>Open a plant and tap <b>List on Marketplace</b> (or use <b>Save &amp; list</b> when saving).");
    return;
  }

  // running totals from the AVAILABLE (unsold) listings
  const avail = marketRows.filter((p) => !p.sold);
  let lo = 0, hi = 0, props = 0;
  avail.forEach((p) => {
    const a = p.ai_result || {};
    const [mn, mx] = parseRange((a.established && a.established.est_price_range) || (a.marketability && a.marketability.est_price_range));
    lo += mn;
    hi += mx;
    props += p.props_in_progress || 0;
  });
  const stats = `<div class="mstats">
    <div class="mstat"><div class="mn">$${Math.round(lo)}–$${Math.round(hi)}</div><div class="ml">potential value</div></div>
    <div class="mstat"><div class="mn">${avail.length}</div><div class="ml">for sale</div></div>
    <div class="mstat"><div class="mn">${props}</div><div class="ml">props rooting</div></div>
  </div>`;

  const pool = showSold ? marketRows : avail;
  const rows = pool.map((p) => ({ p, x: metrics(p) }));
  const cmp = {
    opp: (a, b) => b.x.opp - a.x.opp,
    prop: (a, b) => b.x.propPrice - a.x.propPrice || b.x.propScore - a.x.propScore,
    plant: (a, b) => b.x.estPrice - a.x.estPrice || b.x.estScore - a.x.estScore,
    easy: (a, b) => b.x.ease - a.x.ease || Math.max(b.x.propScore, b.x.estScore) - Math.max(a.x.propScore, a.x.estScore),
  }[marketSort];
  rows.sort((a, b) => a.p.sold - b.p.sold || cmp(a, b)); // sold ones sink to the bottom
  list.innerHTML = stats + (rows.length ? rows.map(({ p, x }) => mrow(p, x)).join("") : `<div class="empty">Nothing for sale right now.</div>`);
  list.querySelectorAll(".mrow").forEach((el, i) => (el.onclick = () => showResult(rows[i].p.ai_result, rows[i].p, rows[i].p.thumbnail)));
}

function mrow(p, x) {
  const m = memberBy(p.owner);
  const img = p.thumbnail ? `<img class="mph" src="${p.thumbnail}" alt="">` : `<div class="mnoph">🪴</div>`;
  const title = p.nickname || p.common_name || p.species;
  const ease = (x.m.propagation_ease || "").toLowerCase();
  const propTag = p.props_in_progress ? `<span title="propagations rooting">🌱 ${p.props_in_progress} rooting</span>` : "";
  return `<div class="mrow${p.sold ? " sold" : ""}">${img}
    <div>
      <div class="mname">${esc(title)} <span class="owndot" style="background:${m.color}" title="${esc(m.display_name)}">${esc((m.display_name[0] || "?").toUpperCase())}</span>${p.sold ? ` <span class="soldtag">Sold</span>` : ""}</div>
      <div class="msp">${esc(p.common_name || p.species)}</div>
      <div class="mtags">
        <span>✂️ <b>${x.propScore || "–"}</b> ${esc(x.m.est_price_range || "")}</span>
        ${x.e ? `<span>🪴 <b>${x.estScore || "–"}</b> ${esc(x.e.est_price_range || "")}</span>` : ""}
        <span class="ease-${ease}">${esc(cap(ease) || "—")} prop</span>
        ${propTag}
      </div>
    </div>
    <div class="opp"><div class="on">${x.opp}</div><div class="ol">sell score</div></div>
  </div>`;
}

/* ---------- result rendering (care / diagnosis / propagation / resale) ---------- */
const DX_TITLE = { healthy: "Looks healthy", watch: "Worth watching", issue: "Needs attention" };
const EMPTY_ART =
  `<svg viewBox="0 0 48 48" fill="none" stroke="#7fa07a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M24 43V21"/><path d="M24 27c-7.5 0-12.5-4.5-13-12.5 8 .5 13 4.5 13 12.5z"/><path d="M24 23c6.5 0 11-3.5 11.5-10.5-7 .5-11.5 3.5-11.5 10.5z"/></svg>`;
const emptyState = (msg) => `<div class="empty" style="grid-column:1/-1">${EMPTY_ART}${msg}</div>`;

/* light & temperature as min→thrives→max ranges (used by BOTH summary and detail) */
const hasLight = (c) => !!(c && c.light && typeof c.light === "object");
const hasTemp = (c) => !!(c && c.temp && typeof c.temp === "object");
const sunThriving = (c) => (hasLight(c) ? c.light.thriving : c.sunlight || "—");
const soilShort = (c) => c.soil_short || c.soil_store_bought || "—";
const waterShort = (c) => c.water_short || c.watering || "—";
const tempIdeal = (c) => (hasTemp(c) ? `${c.temp.ideal_low_f}–${c.temp.ideal_high_f}°F sweet spot` : c.temperature || "—");

function tempBar(t) {
  const span = Math.max(1, t.max_f - t.min_f);
  const clamp = (x) => Math.max(0, Math.min(100, x));
  const l = clamp(((t.ideal_low_f - t.min_f) / span) * 100);
  const w = clamp(((t.ideal_high_f - t.ideal_low_f) / span) * 100);
  return `<div class="rb">
    <div class="rb-track"><div class="rb-band" style="left:${l}%;width:${w}%"></div></div>
    <div class="rb-ends"><span>${t.min_f}°F</span><span class="rb-mid">Thrives ${t.ideal_low_f}–${t.ideal_high_f}°F</span><span>${t.max_f}°F</span></div>
    ${t.note ? `<div class="rb-note">${esc(t.note)}</div>` : ""}
  </div>`;
}

function lightZones(L) {
  return `<div class="lz">
    <div class="lz-cell"><b>Min · survives</b><span>${esc(L.floor)}</span></div>
    <div class="lz-cell on"><b>Thrives</b><span>${esc(L.thriving)}</span></div>
    <div class="lz-cell"><b>Max</b><span>${esc(L.ceiling)}</span></div>
  </div>`;
}

function renderSummary(d) {
  const c = d.care || {};
  // marketplace value up top — what's this plant worth to sell
  const m = d.marketability || {};
  const e = d.established;
  let html = "";
  const ed = d.edible;
  if (ed && typeof ed === "object") {
    const st = edStatus(ed);
    const eat = st === "edible" || st === "parts_edible";
    html += `<div class="sed ${st}">${ED_ICON[st]} <span><b>${ED_LABEL[st]}</b>${eat && ed.score != null ? ` · ${ed.score}/10` : ""}${ed.summary ? ` — ${esc(ed.summary)}` : ""}</span></div>`;
  }
  html += `<div class="svalue">
    <div class="sv-item"><span class="sv-k">✂️ Cuttings</span><span class="sv-p">${esc(m.est_price_range || "—")}</span><span class="sv-s">${m.score ?? "–"}/10</span></div>
    ${e ? `<div class="sv-item"><span class="sv-k">🪴 Whole plant</span><span class="sv-p">${esc(e.est_price_range || "—")}</span><span class="sv-s">${e.score ?? "–"}/10</span></div>` : ""}
  </div>`;
  const tiles = [
    ["☀️ Sun", sunThriving(c)], ["🪴 Soil", soilShort(c)], ["💧 Water", waterShort(c)],
    ["🌡️ Temp", tempIdeal(c)], ["💦 Humidity", c.humidity || "—"],
  ];
  html += `<div class="sgrid">${tiles
    .map(([k, v]) => `<div class="stile"><div class="sk">${k}</div><div class="sv">${esc(v)}</div></div>`)
    .join("")}</div>`;
  if (hasLight(c)) html += `<div class="srange"><div class="srk">Light range</div>${lightZones(c.light)}</div>`;
  if (hasTemp(c)) html += `<div class="srange"><div class="srk">Temperature</div>${tempBar(c.temp)}</div>`;
  $("summary").innerHTML = html;
}

function renderCareDetail(c) {
  let html = `<div class="soil2">
    <div class="soilopt"><b>Buy it · all-in-one</b><span>${esc(c.soil_store_bought)}</span></div>
    <div class="soilopt"><b>Mix it · DIY</b><span>${esc(c.soil_diy)}</span></div>
  </div>`;
  if (hasLight(c)) html += `<div class="caresub">Light — survives → thrives → too much</div>${lightZones(c.light)}`;
  else if (c.sunlight) html += `<div class="caresub">Sunlight</div><div class="care"><div class="c"><span>${esc(c.sunlight)}</span></div></div>`;
  if (hasTemp(c)) html += `<div class="caresub">Temperature</div>${tempBar(c.temp)}`;
  else if (c.temperature) html += `<div class="caresub">Temperature</div><div class="care"><div class="c"><span>${esc(c.temperature)}</span></div></div>`;
  const rows = [["Watering", c.watering], ["Humidity", c.humidity], ["Feeding", c.feeding]].filter(([, v]) => v);
  html += `<div class="care" style="margin-top:15px">${rows
    .map(([k, v]) => `<div class="c"><b>${k}</b><span>${esc(v)}</span></div>`)
    .join("")}</div>`;
  $("care").innerHTML = html;
}

/* summary ⇄ detail toggle (sticky preference; opens on Summary by default) */
let viewMode = localStorage.getItem("rootwork_mode") || "summary";
function applyMode() {
  $("summary").classList.toggle("on", viewMode === "summary");
  $("detailBody").style.display = viewMode === "summary" ? "none" : "block";
  document.querySelectorAll("#modeToggle button").forEach((b) => b.classList.toggle("on", b.dataset.mode === viewMode));
}
function setMode(m) {
  viewMode = m;
  localStorage.setItem("rootwork_mode", m);
  applyMode();
}

function renderDiagnosis(dx) {
  const st = ["healthy", "watch", "issue"].includes(dx.status) ? dx.status : "watch";
  const issues = (dx.issues || [])
    .map((i) => {
      const sev = ["low", "medium", "high"].includes(i.severity) ? i.severity : "medium";
      const remedy = i.home_remedy ? `<div class="lab">Home remedy</div><p>${esc(i.home_remedy)}</p>` : "";
      const link = i.learn_query
        ? `<a href="https://www.google.com/search?q=${encodeURIComponent(i.learn_query)}" target="_blank" rel="noopener">How to fix this →</a>`
        : "";
      return `<div class="issue"><div class="issue-h"><b>${esc(i.condition)}</b><span class="sev ${sev}">${sev}</span></div>${
        i.signs ? `<div class="lab">What I'm seeing</div><p>${esc(i.signs)}</p>` : ""
      }<div class="lab">Do this</div><p>${esc(i.action)}</p>${remedy}${link}</div>`;
    })
    .join("");
  $("dx").className = `dx ${st}`;
  $("dx").innerHTML = `<div class="dx-top"><span class="dot"></span>${DX_TITLE[st]}</div><div class="dx-sum">${esc(dx.summary)}</div>${issues}`;
}

function links(species) {
  const q = encodeURIComponent(species + " propagation");
  return [
    ["Google", `https://www.google.com/search?q=${q}`],
    ["YouTube", `https://www.youtube.com/results?search_query=${q}`],
    ["r/plantclinic", `https://www.reddit.com/r/plantclinic/search/?q=${encodeURIComponent(species)}&restrict_sr=1`],
  ];
}

function render(d) {
  $("name").textContent = d.common_name;
  $("latin").textContent = d.confidence ? `${d.species} · ${Math.round(d.confidence * 100)}% match` : d.species;
  renderDiagnosis(d.diagnosis);
  renderSummary(d);
  renderCareDetail(d.care);
  renderEdible(d.edible);
  applyMode();
  $("tags").innerHTML = [d.method, d.difficulty, d.timeline].map((t) => `<span class="tag">${esc(t)}</span>`).join("");
  $("svg").innerHTML = d.diagram_svg;
  $("steps").innerHTML = d.steps.map((s) => `<li>${esc(s)}</li>`).join("");
  renderResale(d);
  $("links").innerHTML = links(d.species)
    .map(([l, u]) => `<a href="${u}" target="_blank" rel="noopener">${l}</a>`)
    .join("");
  card.style.display = "block";
}

/* ---------- resale (cuttings + whole plant) ---------- */
const cap = (s) => (s ? String(s)[0].toUpperCase() + String(s).slice(1) : "");

function rcard(title, score, price, meta, notes) {
  return `<div class="rcard">
    <div class="rh"><span class="rt">${title}</span><span class="rs">${score ?? "–"}<small>/10</small></span></div>
    <div class="price">${esc(price || "—")}</div>
    <div class="meta">${esc(meta || "")}</div>
    ${notes ? `<div class="notes">${esc(notes)}</div>` : ""}
  </div>`;
}

function renderResale(d) {
  const m = d.marketability || {};
  const e = d.established;
  let html = `<div class="resale2">`;
  html += rcard(
    "✂️ Cuttings / props",
    m.score,
    m.est_price_range,
    `${cap(m.demand)} demand · ${cap(m.rarity)} · ${cap(m.propagation_ease)} to propagate`,
    m.sell_notes
  );
  if (e)
    html += rcard(
      "🪴 Whole plant",
      e.score,
      e.est_price_range,
      `${cap(e.demand)} demand${e.best_size_to_sell ? ` · best at ${e.best_size_to_sell}` : ""}`,
      e.sell_notes
    );
  $("resale").innerHTML = html + `</div>`;
}

/* ---------- edible / foraging ---------- */
const ED_LABEL = { edible: "Edible", parts_edible: "Parts edible", not_edible: "Not edible", toxic: "Toxic" };
const ED_ICON = { edible: "🍽", parts_edible: "🍽", not_edible: "🚫", toxic: "☠️" };
const FORAGE_SAFETY =
  "Identify with 100% certainty before eating — never on a photo or app guess. Some toxic lookalikes are deadly.";
const edStatus = (e) => (["edible", "parts_edible", "not_edible", "toxic"].includes(e && e.status) ? e.status : "not_edible");

function renderEdible(e) {
  const sec = $("edible-sec"), box = $("edible");
  if (!e || typeof e !== "object") {
    sec.style.display = "none";
    return;
  }
  sec.style.display = "block";
  const st = edStatus(e);
  const eat = st === "edible" || st === "parts_edible";
  const rows = [["Edible parts", e.edible_parts], ["Easiest forage", e.forage], ["Easiest prep", e.prepare]].filter(([, v]) => v);
  let html = `<div class="ed-head"><span class="ed-badge ${st}">${ED_ICON[st]} ${ED_LABEL[st]}</span>${
    eat ? `<span class="ed-score">${e.score ?? "–"}<small>/10</small></span>` : ""
  }</div>`;
  if (e.summary) html += `<p class="ed-sum">${esc(e.summary)}</p>`;
  if (rows.length) html += `<div class="ed-rows">${rows.map(([k, v]) => `<div class="c"><b>${k}</b><span>${esc(v)}</span></div>`).join("")}</div>`;
  html += `<div class="caution"><div class="ct">⚠ Forage safely</div><p>${FORAGE_SAFETY}</p>${e.caution ? `<p>${esc(e.caution)}</p>` : ""}</div>`;
  box.innerHTML = html;
}

/* ================= SOIL LAB ================= */
const RECIPES = [
  { key: "general", name: "All-purpose indoor", ratio: "2 coir : 1 perlite : 1 sand",
    ingredients: [{ name: "Coco coir (or peat)", parts: "2" }, { name: "Perlite", parts: "1" }, { name: "Coarse sand", parts: "1" }],
    suits: ["Pothos", "Philodendron", "Peace lily", "Dracaena", "Dieffenbachia", "Spider plant", "Schefflera", "ZZ", "Rubber plant"],
    method: "Pre-wet the coir so it absorbs evenly, then mix until uniform (with peat, add a pinch of lime). The baseline mix — go chunkier for anything epiphytic.",
    storage: "Sealed bin, kept dry — coir rehydrates cleaner than peat.",
    bulk: "Coco coir — cheapest as compressed bricks (1 kg ≈ 5 L hydrated)." },
  { key: "aroid", name: "Chunky aroid mix", ratio: "2 bark : 2 perlite : 1 coir : ½ charcoal",
    ingredients: [{ name: "Orchid bark", parts: "2" }, { name: "Perlite or pumice", parts: "2" }, { name: "Coco coir", parts: "1" }, { name: "Horticultural charcoal", parts: "½" }],
    suits: ["Monstera", "Pothos", "Philodendron", "Syngonium", "Rhaphidophora", "Anthurium", "Alocasia"],
    method: "Pre-hydrate the coir, then toss everything to a uniform chunky texture — one mix top to bottom, no drainage layer. Push bark higher for epiphytic Anthurium; go a touch finer/moister for crawling philodendrons.",
    storage: "Dry & sealed; shake dust off the bark first. Bark lasts ~18–24 months.",
    bulk: "Orchid bark — biggest volume and degrades fastest, so highest turnover. This is the hot seller." },
  { key: "succulent", name: "Succulent & cactus (gritty)", ratio: "1 soil : 1 sand/pumice : 1 perlite",
    ingredients: [{ name: "Potting soil or coir", parts: "1" }, { name: "Coarse sand or pumice", parts: "1" }, { name: "Perlite", parts: "1" }],
    suits: ["Echeveria", "Aloe", "Haworthia", "Sedum", "Sempervivum", "Jade", "Cacti"],
    method: "Mix dry to a light, gritty texture water runs straight through. Coarse sand only — never fine play sand. For true desert cacti push grit to 2 mineral : 1 organic.",
    storage: "Stores well dry & compact; re-fluff before bagging.",
    bulk: "Pumice (premium, non-floating) or coarse sand by the 50 lb bag." },
  { key: "seed", name: "Seed-starting / propagation", ratio: "1 coir : 1 perlite : 1 vermiculite",
    ingredients: [{ name: "Coco coir (or peat)", parts: "1" }, { name: "Perlite", parts: "1" }, { name: "Vermiculite", parts: "1" }],
    suits: ["Seeds", "Soft cuttings", "Coleus", "Tradescantia", "Herbs"],
    method: "Pre-wet coir & vermiculite, blend, moisten before sowing. Deliberately fine and LOW-nutrient so tender new roots don't burn. For cuttings, just coir + perlite.",
    storage: "Sealed, slightly dry; pasteurize first if it contains any compost (prevents damping-off).",
    bulk: "Coco coir — compressed bricks are the value form." },
  { key: "orchid", name: "Orchid bark (4:1:1)", ratio: "4 bark : 1 perlite : 1 charcoal",
    ingredients: [{ name: "Medium fir bark", parts: "4" }, { name: "Perlite", parts: "1" }, { name: "Horticultural charcoal", parts: "1" }],
    suits: ["Phalaenopsis", "Cattleya", "Dendrobium", "Oncidium", "Miltonia"],
    method: "Soak the bark briefly so it isn't hydrophobic, combine, pot loosely for air gaps. Never use regular soil — it suffocates and rots orchid roots.",
    storage: "Don't stockpile — bark mixes break down; replace every ~2 years.",
    bulk: "Fir/orchid bark — it's 80%+ of the mix." },
  { key: "hoya", name: "Hoya / epiphyte", ratio: "5 bark : 2 perlite : 2 coir : ½ charcoal : ½ castings",
    ingredients: [{ name: "Orchid bark", parts: "5" }, { name: "Perlite", parts: "2" }, { name: "Coco coir", parts: "2" }, { name: "Charcoal", parts: "½" }, { name: "Worm castings", parts: "½" }],
    suits: ["Hoya", "Epiphytes"],
    method: "Pre-hydrate coir, then mix into the bark with perlite, charcoal and castings. Chunkier than an aroid mix so roots dry fast — epiphytes rot if kept wet. Simple version: 2 bark : 2 perlite : 1 coir.",
    storage: "Cool, dry, sealed; keep castings dry (they clump). Bark ~18 months.",
    bulk: "Orchid bark — half the mix." },
  { key: "calathea", name: "Calathea / prayer plant", ratio: "2 coir : 1 fine bark : 1 perlite",
    ingredients: [{ name: "Coco coir (or peat)", parts: "2" }, { name: "Fine bark", parts: "1" }, { name: "Perlite", parts: "1" }],
    suits: ["Calathea", "Maranta", "Stromanthe", "Ctenanthe"],
    method: "Hydrate coir, fold in bark & perlite (a pinch of castings + charcoal optional). Should feel spongy yet crumbly with visible air pockets — steady moisture without sogginess.",
    storage: "Use relatively fresh — high organic content compacts; refresh yearly.",
    bulk: "Coco coir — the dominant fraction and moisture buffer." },
  { key: "fern", name: "Fern / moisture-lover", ratio: "1 coir : 1 vermiculite : 1 sphagnum",
    ingredients: [{ name: "Coco coir (or peat)", parts: "1" }, { name: "Vermiculite", parts: "1" }, { name: "Sphagnum moss", parts: "1" }, { name: "Charcoal", parts: "1 Tbsp/qt" }],
    suits: ["Boston fern", "Maidenhair", "Bird's nest", "Staghorn"],
    method: "Blend evenly, add charcoal to keep the constantly-damp mix sweet, pre-moisten. Vermiculite (not perlite) is chosen for higher water-holding.",
    storage: "Sealed and barely damp; sphagnum/peat dry into hard pucks if left open. Refresh yearly.",
    bulk: "Vermiculite — the moisture workhorse here." },
  { key: "herb", name: "Herb / vegetable", ratio: "2 compost : 1 coir : 1 perlite",
    ingredients: [{ name: "Compost", parts: "2" }, { name: "Coco coir (or peat)", parts: "1" }, { name: "Perlite", parts: "1" }],
    suits: ["Basil", "Parsley", "Thyme", "Mint", "Tomato", "Pepper", "Lettuce"],
    method: "Mix with lime (if peat) and a balanced organic fertilizer — edibles are hungry feeders. Moisten before potting.",
    storage: "Compost is alive — use within a season or two; store sealed but breathable, not airtight-wet.",
    bulk: "Compost — cheapest by the bag or yard." },
  { key: "violet", name: "African violet / begonia", ratio: "2 coir : 1 perlite : 1 vermiculite",
    ingredients: [{ name: "Coco coir (or peat)", parts: "2" }, { name: "Perlite", parts: "1" }, { name: "Vermiculite", parts: "1" }],
    suits: ["African violet", "Streptocarpus", "Episcia", "Begonia"],
    method: "Blend to a loose, fluffy, crumbly texture; add dolomite lime to pH 6.5–6.8. Airy, not dense. For wick-watering, push perlite to 50–60% and drop the vermiculite.",
    storage: "Stores well sealed & dry; high perlite fraction resists compaction.",
    bulk: "Coarse perlite — 25–60% of the mix." },
];

const GUIDES = [
  { key: "bulk", name: "Buying components in bulk", lines: [
    "Perlite — a 4 cu ft compressed bag from a grower supplier is often 50–70% cheaper per litre than retail. ⚠️ Wet it before handling; the dust is a lung irritant.",
    "Coco coir — buy compressed bricks, not loose bags. 1 kg ≈ 5 L once soaked (30–60 min, warm water). Get rinsed/buffered low-EC coir to avoid salt.",
    "Orchid bark — a 2 cu ft box from orchid suppliers beats 4-qt retail. Breaks down in 1–3 yrs, so don't over-stock; keep dry or it molds.",
    "Pumice — by weight at masonry/pottery/bonsai suppliers. Durable, rinsable, reusable — a premium upgrade over perlite.",
    "Coarse sand — a 50 lb bag of 'sharp/coarse/quartz' sand at a masonry yard (never play sand). ⚠️ Silica dust: keep damp, wear a mask.",
    "Worm castings — a big bag or a local worm farm; the microbes fade after 6–12 months, so buy what you'll use.",
    "Vermiculite, charcoal & LECA — large grower bags beat boutique tubs and keep indefinitely if stored dry.",
  ] },
  { key: "storage", name: "Storing soil & components", lines: [
    "Dry storage is the #1 rule — fungus gnats and mold need moist organic media. Dry mixes & components before sealing (not powder-dry, just dry).",
    "Use sealed rigid bins with tight lids — a bag clip isn't enough. One bin per raw component + one per finished blend = clean inventory.",
    "Keep them cool, dry and low-humidity. Heat + damp speed mold and breakdown.",
    "Use only pasteurized/fully-composted ingredients; more perlite/pumice/bark resists gnats. Sterilize bins with 1:9 bleach:water (30 min), rinse, dry.",
    "Label every bag: mix name · volume (cups) · date made · full ingredients · plant suitability · a quick use note.",
  ] },
];

let soilView = "recipes";
let soilPacks = [];
let currentSoil = null;

function loadSoil() {
  renderRecipes();
  setSoilView(soilView);
}
function setSoilView(v) {
  soilView = v;
  $("soil-recipes").style.display = v === "recipes" ? "block" : "none";
  $("soil-packs").style.display = v === "packs" ? "block" : "none";
  document.querySelectorAll("#soil-toggle button").forEach((b) => b.classList.toggle("on", b.dataset.soil === v));
  if (v === "packs") loadSoilPacks();
}

function renderRecipes() {
  const box = $("soil-recipes");
  const guides = GUIDES.map(
    (g) => `<div class="recipe" data-key="g-${g.key}">
      <div class="recipe-h"><div class="rn">${esc(g.name)}</div><span class="chev">▾</span></div>
      <div class="recipe-body">${g.lines.map((l) => `<div class="rtip" style="margin-top:8px">${esc(l)}</div>`).join("")}</div>
    </div>`
  ).join("");
  const recipes = RECIPES.map((r) => {
    const ings = r.ingredients.map((i) => `<div class="ing"><span>${esc(i.name)}</span><b>${esc(i.parts)}</b></div>`).join("");
    const suits = r.suits.map((s) => `<span>${esc(s)}</span>`).join("");
    return `<div class="recipe" data-key="${r.key}">
      <div class="recipe-h"><div><div class="rn">${esc(r.name)}</div><div class="rmeta">${esc(r.ratio)}</div></div><span class="chev">▾</span></div>
      <div class="recipe-body">
        <div class="rsub">Mix (parts by volume)</div>${ings}
        <div class="rsub">Good for</div><div class="suits">${suits}</div>
        <div class="rsub">How</div><div class="rtip">${esc(r.method)}</div>
        <div class="rsub">Storage</div><div class="rtip">${esc(r.storage)}</div>
        <div class="rsub">Buy in bulk</div><div class="rtip">${esc(r.bulk)}</div>
        <button class="makebtn" data-make="${r.key}">＋ Make a batch from this</button>
      </div></div>`;
  }).join("");
  box.innerHTML = `<div class="rsub" style="margin:4px 0 8px">Maker's guide</div>${guides}<div class="rsub" style="margin:16px 0 8px">Recipes — pick the right blend per plant</div>${recipes}`;
  box.querySelectorAll(".recipe-h").forEach((h) => (h.onclick = () => h.parentElement.classList.toggle("open")));
  box.querySelectorAll("[data-make]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); makePack(b.dataset.make); }));
}

async function postSoil(body) {
  try {
    const r = await fetch("/soil", { method: "POST", headers: { "Content-Type": "application/json", "X-User": me }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error();
    return await r.json();
  } catch (e) {
    alert("Couldn't create that batch — try again.");
    return null;
  }
}
async function makePack(key) {
  if (!me) return showPicker();
  const r = RECIPES.find((x) => x.key === key);
  if (!r) return;
  const btn = document.querySelector(`[data-make="${key}"]`);
  if (btn) { btn.disabled = true; btn.textContent = "Mixing & pricing…"; }
  const pack = await postSoil({
    name: r.name, recipe_key: r.key, size: "1 quart",
    recipe: { ingredients: r.ingredients, suits: r.suits }, visibility: "private", in_market: false,
  });
  if (btn) { btn.disabled = false; btn.textContent = "＋ Make a batch from this"; }
  if (pack) { setSoilView("packs"); openSoil(pack); }
}
async function newCustomPack() {
  if (!me) return showPicker();
  const name = prompt("Name this mix (e.g. 'My custom aroid blend'):");
  if (!name) return;
  const pack = await postSoil({ name, recipe_key: "custom", size: "1 quart", recipe: {}, visibility: "private", in_market: false });
  if (pack) openSoil(pack);
}

async function loadSoilPacks() {
  if (!me) return showPicker();
  const box = $("soil-packs");
  box.innerHTML = `<div class="empty">Loading…</div>`;
  try {
    soilPacks = await (await fetch("/soil/mine", { headers: { "X-User": me } })).json();
  } catch (e) { soilPacks = []; }
  drawSoilPacks();
}
function drawSoilPacks() {
  const box = $("soil-packs");
  let html = `<button class="soilnew" id="soilNew">＋ New batch from scratch</button>`;
  html += soilPacks.length
    ? soilPacks.map(spackCard).join("")
    : emptyState("No batches yet.<br>Open a recipe and tap <b>Make a batch</b>.");
  box.innerHTML = html;
  $("soilNew").onclick = newCustomPack;
  box.querySelectorAll(".spack").forEach((el, i) => (el.onclick = () => openSoil(soilPacks[i])));
}
function spackCard(sp) {
  const m = sp.market || {};
  const img = sp.thumbnail ? `<img class="sph" src="${sp.thumbnail}" alt="">` : `<div class="snoph">🪴</div>`;
  const badges = `${sp.in_market ? '<span class="sb market">Listed</span>' : ""}${sp.sold ? '<span class="sb sold">Sold</span>' : ""}`;
  return `<div class="spack">${img}
    <div><div class="snm">${esc(sp.name)}</div>
      <div class="ssz">${esc(sp.size || "")}${m.score ? ` · sell ${m.score}/10` : ""}</div>
      ${badges ? `<div class="sbadges">${badges}</div>` : ""}</div>
    <div class="sprice">${m.est_price_range ? `<b>${esc(m.est_price_range)}</b>` : ""}</div></div>`;
}

function openSoil(sp) {
  currentSoil = sp;
  renderSoilDetail();
  $("soilDetail").classList.add("on");
}
function closeSoil() {
  $("soilDetail").classList.remove("on");
  if (soilView === "packs") loadSoilPacks();
}
async function soilPatch(fields, rerender = true) {
  try {
    const r = await fetch("/soil/" + currentSoil.id, { method: "PATCH", headers: { "Content-Type": "application/json", "X-User": me }, body: JSON.stringify(fields) });
    if (r.ok) { currentSoil = await r.json(); if (rerender) renderSoilDetail(); }
  } catch (e) { /* keep UI */ }
}
async function soilDelete() {
  if (!confirm("Delete this batch?")) return;
  await fetch("/soil/" + currentSoil.id, { method: "DELETE", headers: { "X-User": me } });
  closeSoil();
}
function renderSoilDetail() {
  const sp = currentSoil, m = sp.market || {}, rec = sp.recipe || {}, mine = sp.owner === me, owner = memberBy(sp.owner);
  const ings = (rec.ingredients || []).map((i) => `<div class="ing"><span>${esc(i.name)}</span><b>${esc(i.parts || "")}</b></div>`).join("");
  const suits = (rec.suits || []).map((s) => `<span>${esc(s)}</span>`).join("");
  let html = `<h2 class="vh" style="margin:2px 0 2px">${esc(sp.name)}</h2>
    <div class="ssz" style="margin-bottom:12px">${esc(sp.size || "")} · by ${esc(owner.display_name)}</div>`;
  if (sp.thumbnail) html += `<img src="${sp.thumbnail}" style="width:100%;max-height:240px;object-fit:cover;border-radius:12px;border:1px solid var(--rule)" alt="">`;
  html += `<div class="rcard" style="margin-top:14px"><div class="rh"><span class="rt">Market value</span><span class="rs">${m.score ?? "–"}<small>/10</small></span></div>
    <div class="price">${esc(m.est_price_range || "—")}</div>
    <div class="meta">${m.demand ? esc(cap(m.demand)) + " demand" : ""}</div>
    ${m.sell_notes ? `<div class="notes">${esc(m.sell_notes)}</div>` : ""}</div>`;
  if (ings || suits) {
    html += `<div class="sec"><h3 class="sec-h">Recipe</h3>${ings}${suits ? `<div class="rsub">Good for</div><div class="suits">${suits}</div>` : ""}</div>`;
  }
  if (mine) {
    html += `<div class="savedrow" style="margin-top:16px">
      <div class="who">Manage</div>
      <div class="seg" id="soilVis"><button data-v="private" class="${sp.visibility === "private" ? "on" : ""}">Private</button><button data-v="family" class="${sp.visibility === "family" ? "on" : ""}">Family</button></div>
      <input class="nick" id="soilSize" placeholder="Size (e.g. 2 qt bag)" value="${esc(sp.size)}" />
      <button class="mktbtn ${sp.in_market ? "on" : ""}" id="soilMkt">${sp.in_market ? "✓ Listed on Marketplace" : "＋ List on Marketplace"}</button>
      <div class="mline2"><button class="mgbtn ${sp.sold ? "on" : ""}" id="soilSold">${sp.sold ? "↩ Mark available" : "✓ Mark as sold"}</button></div>
      <div class="mline2"><button class="link" id="soilPhoto">${sp.thumbnail ? "Change photo" : "Add photo"}</button></div>
      <button class="delbtn" id="soilDel">Delete batch</button>
    </div>`;
  }
  $("soilBody").innerHTML = html;
  if (mine) {
    $("soilVis").querySelectorAll("button").forEach((b) => (b.onclick = () => soilPatch({ visibility: b.dataset.v })));
    $("soilSize").onblur = (e) => soilPatch({ size: e.target.value }, false);
    $("soilMkt").onclick = () => soilPatch({ in_market: !currentSoil.in_market });
    $("soilSold").onclick = () => soilPatch({ sold: !currentSoil.sold });
    $("soilPhoto").onclick = () => $("soilPhotoInput").click();
    $("soilDel").onclick = soilDelete;
  }
}

/* ---------- boot ---------- */
chip.onclick = showPicker;
document.querySelectorAll("nav.tabs button").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
document.querySelectorAll("#modeToggle button").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
document.querySelectorAll("[data-export]").forEach((b) => (b.onclick = () => exportPhotos(b.dataset.export)));
$("galleryInput").onchange = (e) => { const f = [...e.target.files]; e.target.value = ""; addGalleryPhotos(f); };
$("lbClose").onclick = closeLightbox;
$("lightbox").onclick = (e) => { if (e.target.id === "lightbox") closeLightbox(); };
document.querySelectorAll("#soil-toggle button").forEach((b) => (b.onclick = () => setSoilView(b.dataset.soil)));
$("soilClose").onclick = closeSoil;
$("soilPhotoInput").onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f || !currentSoil) return;
  await soilPatch({ thumbnail: await thumbDataURL(f) });
};

(async function init() {
  try {
    members = await (await fetch("/members")).json();
  } catch (e) {
    members = [{ slug: "mike", display_name: "Mike", color: "#c0703a" }, { slug: "kelly", display_name: "Kelly", color: "#5f8d6b" }];
  }
  me = localStorage.getItem("rootwork_user");
  if (me && isMember(me)) renderChip();
  else {
    me = null;
    showPicker();
  }
})();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {});
  // when a new service worker takes control, refresh once so the latest UI shows
  let _reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (_reloaded) return;
    _reloaded = true;
    location.reload();
  });
}
