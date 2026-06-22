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

/* ---------- boot ---------- */
chip.onclick = showPicker;
document.querySelectorAll("nav.tabs button").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
document.querySelectorAll("#modeToggle button").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
document.querySelectorAll("[data-export]").forEach((b) => (b.onclick = () => exportPhotos(b.dataset.export)));
$("galleryInput").onchange = (e) => { const f = [...e.target.files]; e.target.value = ""; addGalleryPhotos(f); };
$("lbClose").onclick = closeLightbox;
$("lightbox").onclick = (e) => { if (e.target.id === "lightbox") closeLightbox(); };

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
