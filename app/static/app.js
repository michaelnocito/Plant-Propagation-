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
let lastBlob = null;        // the just-analyzed image blob (for on-demand health check)
let mineRows = [], familyRows = [];
const filterState = { mine: "all", family: "all" };
const searchState = { mine: "", family: "" };
const lightState  = { mine: "any", family: "any" };
const soilState   = { mine: "any", family: "any" };

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
  if (name === "market") showMarketView(marketView);
  if (name === "soil") loadSoil();
  if (name === "seed") loadSeeds();
}

/* ---------- identify ---------- */
const LOADER_MSGS = [
  "Reading your photo…", "Asking the plant its name…", "Mixing up care tips…",
  "Sketching how to propagate it…", "Almost there…",
];
let loaderTimer = null;
function startLoader() {
  let i = 0;
  $("loaderMsg").textContent = LOADER_MSGS[0];
  $("loader").classList.add("on");
  clearInterval(loaderTimer);
  loaderTimer = setInterval(() => {
    i = (i + 1) % LOADER_MSGS.length;
    $("loaderMsg").textContent = LOADER_MSGS[i];
  }, 3500);
}
function stopLoader() {
  clearInterval(loaderTimer);
  $("loader").classList.remove("on");
}

// POST with a timeout + one automatic retry (free-tier cold starts are slow)
async function propagate(blob) {
  const attempt = async (ms) => {
    const fd = new FormData();
    fd.append("file", blob, "plant.jpg");
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch("/propagate", { method: "POST", body: fd, signal: ctrl.signal });
      if (!r.ok) {
        const detail = await r.json().catch(() => ({}));
        throw Object.assign(new Error(detail.detail || r.statusText), { status: r.status });
      }
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  };
  try {
    return await attempt(70000);
  } catch (err) {
    // a 422 (no plant found) is a real answer — don't retry it
    if (err.status === 422) throw err;
    $("loaderMsg").textContent = "Waking the server — one more try…";
    return await attempt(90000);
  }
}

pick.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  card.style.display = "none";
  status.className = "status";
  status.textContent = "";
  startLoader();
  try {
    const blob = await compress(file);
    lastBlob = blob;
    lastThumb = await thumbDataURL(file);
    lastPhotoData = await blobToDataURL(blob);
    $("thumb").src = URL.createObjectURL(blob);
    $("thumb").style.display = "block";
    showResult(await propagate(blob), null, "");
    status.textContent = "";
  } catch (err) {
    status.className = "status err";
    status.textContent =
      err.status === 422
        ? "Couldn't spot a plant — try a clearer, closer shot."
        : err.message && err.message.includes("compress")
        ? "Couldn't read that photo — try a different one."
        : "That took too long or failed — tap the photo button to try again.";
    console.error("[rootwork] upload failed:", err);
  } finally {
    stopLoader();
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
  ensureDiagram(d); // background: fill the propagation diagram a few seconds later
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
      <div class="mline" style="margin-top:11px">
        <span>💰 What we paid</span>
        <span class="paidwrap">$<input class="paidinp" id="costInp" type="number" inputmode="decimal" placeholder="0" value="${p.cost ? p.cost : ""}" /></span>
      </div>
      <div class="mline2">
        <button class="mgbtn ${p.sold ? "on" : ""}" id="soldBtn">${p.sold ? "↩ Mark available" : "✓ Mark as sold"}</button>
      </div>
    </div>
    <button class="delbtn" id="delBtn">Remove from my plants</button>
    <button class="syncbtn" id="plantSyncBtn">↻ Sync to server</button>
  </div>`;
  $("catSel").onchange = (e) => patch({ category: e.target.value }, false);
  $("nickInp").onblur = (e) => patch({ nickname: e.target.value }, false);
  $("mktBtn").onclick = () => patch({ in_market: !currentSaved.in_market });
  $("soldBtn").onclick = () => patch({ sold: !currentSaved.sold });
  $("propMinus").onclick = () => stepProps(-1);
  $("propPlus").onclick = () => stepProps(1);
  $("costInp").onblur = (e) => patch({ cost: parseFloat(e.target.value) || 0 }, false);
  $("delBtn").onclick = doDelete;
  $("plantSyncBtn").onclick = () => runSync($("plantSyncBtn"));
}

async function runSync(btn) {
  if (!currentSaved) return;
  btn.disabled = true;
  btn.textContent = "↻ Syncing…";
  try {
    const r = await fetch(`/plants/${currentSaved.id}/sync`, {
      method: "POST", headers: { "X-User": me },
    });
    if (!r.ok) throw new Error();
    const updated = await r.json();
    currentSaved = updated;
    currentResult = updated.ai_result;
    render(currentResult);
    renderSavebar();
    btn.textContent = "✓ Synced";
    setTimeout(() => { if ($("plantSyncBtn")) $("plantSyncBtn").textContent = "↻ Sync to server"; }, 2000);
  } catch {
    btn.disabled = false;
    btn.textContent = "↻ Sync failed — retry";
  }
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
        visibility: "family",
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

function lightBucket(p) {
  const c = p.ai_result?.care?.light;
  if (!c) return "unknown";
  const s = `${c.floor||""} ${c.thriving||""} ${c.ceiling||""}`.toLowerCase();
  if (/direct|full sun|bright direct/.test(s)) return "direct";
  if (/bright indirect|medium indirect|moderate/.test(s)) return "indirect";
  if (/low|dim|shade/.test(s)) return "low";
  return "unknown";
}
function soilBucket(p) {
  const s = `${p.ai_result?.care?.soil_short||""} ${p.ai_result?.care?.soil_diy||""}`.toLowerCase();
  if (/cactus|succulent|grit|sand/.test(s)) return "gritty";
  if (/aroid|orchid|bark|chunky|epiphyte/.test(s)) return "chunky";
  if (/moisture|peat|fern|calathea|tropical/.test(s)) return "moisture";
  if (/standard|all.purpose|potting|general/.test(s)) return "standard";
  return "unknown";
}

function drawCollection(view, rows) {
  const filt = $(view + "-filters");
  const present = CATS.map((c) => c[0]).filter((c) => rows.some((r) => r.category === c));
  const cats = ["all", ...present];
  if (!present.length) filterState[view] = "all";

  const LIGHTS = [["any","Any light"],["low","Low / Shade"],["indirect","Bright Indirect"],["direct","Direct Sun"]];
  const SOILS  = [["any","Any soil"],["standard","Standard"],["chunky","Chunky / Aroid"],["moisture","Moisture-loving"],["gritty","Gritty / Cactus"]];

  filt.innerHTML =
    `<input class="psearch" id="${view}-search" type="search" placeholder="🔍 Search plants…" value="${esc(searchState[view])}" />` +
    `<div class="frow">${cats.map((c) => `<button data-c="${c}" class="fpill ${filterState[view]===c?"on":""}">${c==="all"?"All":catLabel(c)}</button>`).join("")}</div>` +
    `<div class="frow"><span class="flabel">☀️</span>${LIGHTS.map(([k,l]) => `<button data-l="${k}" class="fpill ${lightState[view]===k?"on":""}">${l}</button>`).join("")}</div>` +
    `<div class="frow"><span class="flabel">🌱</span>${SOILS.map(([k,l]) => `<button data-s="${k}" class="fpill ${soilState[view]===k?"on":""}">${l}</button>`).join("")}</div>`;

  $(`${view}-search`).oninput = (e) => { searchState[view] = e.target.value; applyFilters(view, rows); };
  filt.querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => { filterState[view] = b.dataset.c; drawCollection(view, rows); }));
  filt.querySelectorAll("[data-l]").forEach((b) => (b.onclick = () => { lightState[view] = b.dataset.l; drawCollection(view, rows); }));
  filt.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => { soilState[view] = b.dataset.s; drawCollection(view, rows); }));

  applyFilters(view, rows);
}

function applyFilters(view, rows) {
  const grid = $(view + "-grid");
  let shown = rows.filter((r) => filterState[view] === "all" || r.category === filterState[view]);
  if (searchState[view].trim()) {
    const q = searchState[view].toLowerCase();
    shown = shown.filter((r) =>
      (r.nickname||"").toLowerCase().includes(q) ||
      (r.common_name||"").toLowerCase().includes(q) ||
      (r.species||"").toLowerCase().includes(q)
    );
  }
  if (lightState[view] !== "any") shown = shown.filter((r) => lightBucket(r) === lightState[view]);
  if (soilState[view]  !== "any") shown = shown.filter((r) => soilBucket(r)  === soilState[view]);
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
let marketSoil = [];
let marketSeeds = [];
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
  try { marketRows = await (await fetch("/plants/market")).json(); } catch (e) { marketRows = []; }
  try { marketSoil = await (await fetch("/soil/market")).json(); } catch (e) { marketSoil = []; }
  try { marketSeeds = await (await fetch("/seeds/market")).json(); } catch (e) { marketSeeds = []; }
  drawMarket();
}

function drawMarket() {
  const sortEl = $("market-sort"), list = $("market-list");
  const soldCount = marketRows.filter((p) => p.sold).length + marketSoil.filter((s) => s.sold).length + marketSeeds.filter((s) => s.sold).length;
  sortEl.innerHTML =
    MSORTS.map(([k, l]) => `<button data-s="${k}" class="${marketSort === k ? "on" : ""}">${l}</button>`).join("") +
    `<button data-toggle="sold" class="${showSold ? "on" : ""}">${showSold ? "Hide sold" : `Show sold${soldCount ? ` (${soldCount})` : ""}`}</button>`;
  sortEl.querySelectorAll("button[data-s]").forEach((b) => (b.onclick = () => { marketSort = b.dataset.s; drawMarket(); }));
  const tog = sortEl.querySelector("button[data-toggle]");
  if (tog) tog.onclick = () => { showSold = !showSold; drawMarket(); };

  if (!marketRows.length && !marketSoil.length && !marketSeeds.length) {
    list.innerHTML = emptyState("Nothing listed yet.<br>List a plant, soil batch, or seed on the Marketplace.");
    return;
  }

  // running totals from AVAILABLE (unsold) listings — plants + soil + seeds
  const avail = marketRows.filter((p) => !p.sold);
  const availSoil = marketSoil.filter((s) => !s.sold);
  const availSeeds = marketSeeds.filter((s) => !s.sold);
  let lo = 0, hi = 0, props = 0;
  avail.forEach((p) => {
    const a = p.ai_result || {};
    const [mn, mx] = parseRange((a.established && a.established.est_price_range) || (a.marketability && a.marketability.est_price_range));
    lo += mn; hi += mx; props += p.props_in_progress || 0;
  });
  availSoil.forEach((s) => { const [mn, mx] = parseRange((s.market || {}).est_price_range); lo += mn; hi += mx; });
  availSeeds.forEach((s) => { const [mn, mx] = parseRange((s.market || {}).est_price_range); lo += mn; hi += mx; });
  const stats = `<div class="mstats">
    <div class="mstat"><div class="mn">$${Math.round(lo)}–$${Math.round(hi)}</div><div class="ml">potential value</div></div>
    <div class="mstat"><div class="mn">${avail.length + availSoil.length + availSeeds.length}</div><div class="ml">for sale</div></div>
    <div class="mstat"><div class="mn">${props}</div><div class="ml">props rooting</div></div>
  </div>`;

  // plants
  const pool = showSold ? marketRows : avail;
  const rows = pool.map((p) => ({ p, x: metrics(p) }));
  const cmp = {
    opp: (a, b) => b.x.opp - a.x.opp,
    prop: (a, b) => b.x.propPrice - a.x.propPrice || b.x.propScore - a.x.propScore,
    plant: (a, b) => b.x.estPrice - a.x.estPrice || b.x.estScore - a.x.estScore,
    easy: (a, b) => b.x.ease - a.x.ease || Math.max(b.x.propScore, b.x.estScore) - Math.max(a.x.propScore, a.x.estScore),
  }[marketSort];
  rows.sort((a, b) => a.p.sold - b.p.sold || cmp(a, b));
  const plantHTML = rows.map(({ p, x }) => mrow(p, x)).join("");

  // soil mixes
  const soilPool = (showSold ? marketSoil : availSoil).slice();
  soilPool.sort((a, b) => (a.sold - b.sold) || ((b.market || {}).score || 0) - ((a.market || {}).score || 0));
  const soilHTML = soilPool.length ? `<div class="rsub" style="margin:18px 0 8px">Soil mixes</div>` + soilPool.map(soilMarketRow).join("") : "";

  // seeds
  const seedPool = (showSold ? marketSeeds : availSeeds).slice();
  seedPool.sort((a, b) => (a.sold - b.sold) || ((b.market || {}).score || 0) - ((a.market || {}).score || 0));
  const seedHTML = seedPool.length ? `<div class="rsub" style="margin:18px 0 8px">Seeds</div>` + seedPool.map(seedMarketRow).join("") : "";

  const body = plantHTML + soilHTML + seedHTML;
  list.innerHTML = stats + (body || `<div class="empty">Nothing for sale right now.</div>`);
  list.querySelectorAll(".mrow[data-soil]").forEach((el) => (el.onclick = () => {
    const sp = marketSoil.find((s) => s.id == el.dataset.soil);
    if (sp) openSoil(sp);
  }));
  list.querySelectorAll(".mrow[data-seed]").forEach((el) => (el.onclick = () => {
    const sd = marketSeeds.find((s) => s.id == el.dataset.seed);
    if (sd) openSeed(sd);
  }));
  [...list.querySelectorAll(".mrow:not([data-soil]):not([data-seed])")].forEach((el, i) =>
    (el.onclick = () => showResult(rows[i].p.ai_result, rows[i].p, rows[i].p.thumbnail)));
}

function seedMarketRow(sd) {
  const m = sd.market || {}, owner = memberBy(sd.owner);
  const img = sd.thumbnail ? `<img class="mph" src="${sd.thumbnail}" alt="">` : `<div class="mnoph">🌰</div>`;
  return `<div class="mrow seed${sd.sold ? " sold" : ""}" data-seed="${sd.id}">${img}
    <div>
      <div class="mname">${esc(sd.name)} <span class="owndot" style="background:${owner.color}" title="${esc(owner.display_name)}">${esc((owner.display_name[0] || "?").toUpperCase())}</span>${sd.sold ? ` <span class="soldtag">Sold</span>` : ""}</div>
      <div class="msp">Seeds${sd.quantity ? ` · ${esc(sd.quantity)}` : ""}</div>
      <div class="mtags"><span>💲 <b>${esc(m.est_price_range || "—")}</b></span>${m.demand ? `<span>${esc(cap(m.demand))} demand</span>` : ""}</div>
    </div>
    <div class="opp"><div class="on">${(m.score || "–")}</div><div class="ol">sell score</div></div>
  </div>`;
}

function soilMarketRow(sp) {
  const m = sp.market || {}, owner = memberBy(sp.owner);
  const img = sp.thumbnail ? `<img class="mph" src="${sp.thumbnail}" alt="">` : `<div class="mnoph">🟫</div>`;
  return `<div class="mrow soil${sp.sold ? " sold" : ""}" data-soil="${sp.id}">${img}
    <div>
      <div class="mname">${esc(sp.name)} <span class="owndot" style="background:${owner.color}" title="${esc(owner.display_name)}">${esc((owner.display_name[0] || "?").toUpperCase())}</span>${sp.sold ? ` <span class="soldtag">Sold</span>` : ""}</div>
      <div class="msp">Soil mix · ${esc(sp.size || "")}</div>
      <div class="mtags"><span>💲 <b>${esc(m.est_price_range || "—")}</b></span>${m.demand ? `<span>${esc(cap(m.demand))} demand</span>` : ""}</div>
    </div>
    <div class="opp"><div class="on">${(m.score || "–")}</div><div class="ol">sell score</div></div>
  </div>`;
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
const soilShort = (c) => (c.soil_custom && c.soil_custom.name) ? ("🌿 " + c.soil_custom.name) : (c.soil_short || c.soil_store_bought || "—");
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

function renderAbout(d) {
  const a = d.about;
  const sec = $("about-sec");
  if (!a || typeof a !== "object" || !(a.tagline || a.story || a.nickname || (a.fun_facts || []).length)) {
    sec.style.display = "none";
    return;
  }
  sec.style.display = "block";
  const facts = (a.fun_facts || []).filter(Boolean);
  let html = `<div class="about">`;
  if (a.nickname) html += `<div class="about-nick">“${esc(a.nickname)}”</div>`;
  if (a.tagline) html += `<div class="about-tag">🌿 ${esc(a.tagline)}</div>`;
  if (a.story) html += `<div class="about-story">${esc(a.story)}</div>`;
  const rows = [["🌍 Wild home", a.origin], ["📖 Name story", a.name_meaning]].filter(([, v]) => v);
  if (rows.length) html += `<div class="about-rows">${rows.map(([k, v]) => `<div class="about-row"><b>${k}</b><span>${esc(v)}</span></div>`).join("")}</div>`;
  if (facts.length) {
    html += `<div class="about-factsh">✨ Fun facts</div><ul class="about-facts">${facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>`;
  }
  html += `</div>`;
  $("about").innerHTML = html;
}

function renderSummary(d) {
  const c = d.care || {};
  // marketplace value up top — what's this plant worth to sell
  const m = d.marketability || {};
  const e = d.established;
  let html = "";
  const a = d.about;
  if (a && typeof a === "object" && (a.tagline || a.story)) {
    html += `<div class="sabout">
      ${a.tagline ? `<div class="sabout-tag">🌿 ${esc(a.tagline)}</div>` : ""}
      ${a.story ? `<div class="sabout-story">${esc(a.story)}</div>` : ""}
    </div>`;
  }
  const ed = d.edible;
  if (ed && typeof ed === "object") {
    const st = edStatus(ed);
    const eat = st === "edible" || st === "parts_edible";
    html += `<div class="sed ${st}">${ED_ICON[st]} <span><b>${ED_LABEL[st]}</b>${eat && ed.score != null ? ` · ${ed.score}/10` : ""}${ed.summary ? ` — ${esc(ed.summary)}` : ""}</span></div>`;
  }
  if (m.est_price_range || m.score != null) {
    html += `<div class="svalue">
      <div class="sv-item"><span class="sv-k">✂️ Cuttings</span><span class="sv-p">${esc(m.est_price_range || "—")}</span><span class="sv-s">${m.score ?? "–"}/10</span></div>
      ${e ? `<div class="sv-item"><span class="sv-k">🪴 Whole plant</span><span class="sv-p">${esc(e.est_price_range || "—")}</span><span class="sv-s">${e.score ?? "–"}/10</span></div>` : ""}
    </div>`;
  }
  const potIdeal = c.pot?.ideal ? c.pot.ideal.split("—")[0].split("(")[0].split(",")[0].trim() : null;
  const tiles = [
    ["☀️ Sun", sunThriving(c)], ["🪴 Soil", soilShort(c)], ["💧 Water", waterShort(c)],
    ["🌡️ Temp", tempIdeal(c)], ["💦 Humidity", c.humidity || "—"],
    ...(potIdeal ? [["🏺 Pot", potIdeal]] : []),
  ];
  html += `<div class="sgrid">${tiles
    .map(([k, v]) => `<div class="stile"><div class="sk">${k}</div><div class="sv">${esc(v)}</div></div>`)
    .join("")}</div>`;
  if (hasLight(c)) html += `<div class="srange"><div class="srk">Light range</div>${lightZones(c.light)}</div>`;
  if (hasTemp(c)) html += `<div class="srange"><div class="srk">Temperature</div>${tempBar(c.temp)}</div>`;
  $("summary").innerHTML = html;
}

function renderCareDetail(c) {
  const cu = c.soil_custom;
  let html = "";
  if (cu) {
    const ings = (cu.ingredients || []).map((i) => `<div class="ing"><span>${esc(i.name)}</span><b>${esc(i.parts || "")}</b></div>`).join("");
    html += `<div class="myblend">
      <div class="myblend-h"><span>🌿 Your blend</span><button class="blendedit" data-blend="edit">✎ Edit</button></div>
      <div class="myblend-name">${esc(cu.name || "Custom blend")}</div>
      ${cu.ratio ? `<div class="myblend-ratio">${esc(cu.ratio)}</div>` : ""}
      ${ings ? `<div class="myblend-ings">${ings}</div>` : ""}
      ${cu.note ? `<div class="myblend-note">${esc(cu.note)}</div>` : ""}
      <button class="blendremove" data-blend="remove">Remove — use the app's suggestion</button>
    </div>
    <div class="caresub">App's suggestion</div>`;
  }
  html += `<div class="soil2">
    <div class="soilopt"><b>Buy it · all-in-one</b><span>${esc(c.soil_store_bought)}</span></div>
    <div class="soilopt"><b>Mix it · DIY</b><span>${esc(c.soil_diy)}</span></div>
  </div>`;
  if (!cu) html += `<button class="setblend" data-blend="set">✎ Set your own blend for this plant</button>`;
  if (hasLight(c)) html += `<div class="caresub">Light — survives → thrives → too much</div>${lightZones(c.light)}`;
  else if (c.sunlight) html += `<div class="caresub">Sunlight</div><div class="care"><div class="c"><span>${esc(c.sunlight)}</span></div></div>`;
  if (hasTemp(c)) html += `<div class="caresub">Temperature</div>${tempBar(c.temp)}`;
  else if (c.temperature) html += `<div class="caresub">Temperature</div><div class="care"><div class="c"><span>${esc(c.temperature)}</span></div></div>`;
  const rows = [["Watering", c.watering], ["Humidity", c.humidity], ["Feeding", c.feeding]].filter(([, v]) => v);
  html += `<div class="care" style="margin-top:15px">${rows
    .map(([k, v]) => `<div class="c"><b>${k}</b><span>${esc(v)}</span></div>`)
    .join("")}</div>`;
  if (c.pot) {
    html += `<div class="caresub" style="margin-top:15px">🏺 Pot type</div>
    <div class="care">
      <div class="c"><b class="pot-ideal">✓ Ideal</b><span>${esc(c.pot.ideal)}</span></div>
      <div class="c"><b class="pot-good">· Good</b><span>${esc(c.pot.good)}</span></div>
      <div class="c"><b class="pot-never">✗ Never</b><span>${esc(c.pot.never)}</span></div>
    </div>`;
  }
  $("care").innerHTML = html;
  $("care").querySelectorAll("[data-blend]").forEach((b) => (b.onclick = () => blendAction(b.dataset.blend)));
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
  if (!dx) {
    $("dx-sec").style.display = "none";
    return;
  }
  $("dx-sec").style.display = "block";
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
  renderExtras(d);
  renderAbout(d);
  renderDiagnosis(d.diagnosis);
  renderSummary(d);
  renderCareDetail(d.care);
  renderEdible(d.edible);
  applyMode();
  $("tags").innerHTML = [d.method, d.difficulty, d.timeline].map((t) => `<span class="tag">${esc(t)}</span>`).join("");
  $("plate").style.display = d.diagram_svg ? "block" : "none";
  $("svg").innerHTML = d.diagram_svg || "";
  $("steps").innerHTML = d.steps.map((s) => `<li>${esc(s)}</li>`).join("");
  renderResale(d);
  $("links").innerHTML = links(d.species)
    .map(([l, u]) => `<a href="${u}" target="_blank" rel="noopener">${l}</a>`)
    .join("");
  card.style.display = "block";
}

/* ---------- on-demand pricing + health check (split out for speed) ---------- */
function renderExtras(d) {
  const bar = $("extras");
  const btns = [];
  if (!d.marketability) btns.push(["appraise", "💲 Check resale value"]);
  if (!d.diagnosis) btns.push(["diagnose", "🩺 Health check-up"]);
  if (!d.edible) btns.push(["edible", "🌿 Edible & foraging"]);
  if (!btns.length) { bar.style.display = "none"; bar.innerHTML = ""; return; }
  bar.style.display = "grid";
  bar.style.gridTemplateColumns = btns.length > 1 ? "1fr 1fr" : "1fr";
  bar.innerHTML = btns
    .map(([k, l], i) => {
      const span = btns.length > 1 && btns.length % 2 === 1 && i === btns.length - 1 ? ' style="grid-column:1/-1"' : "";
      return `<button class="exbtn" data-ex="${k}"${span}>${l}</button>`;
    })
    .join("");
  const run = { appraise: runAppraise, diagnose: runDiagnose, edible: runEdible };
  bar.querySelectorAll("[data-ex]").forEach((b) => (b.onclick = () => run[b.dataset.ex](b)));
}

async function runEdible(btn) {
  const d = currentResult;
  if (btn) { btn.disabled = true; btn.textContent = "Checking…"; }
  try {
    const r = await fetch("/edible", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ species: d.species, common_name: d.common_name || "" }),
    });
    if (!r.ok) throw new Error();
    d.edible = (await r.json()).edible;
    await persistResultIfSaved();
    render(d);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = "🌿 Edible & foraging — retry"; }
  }
}

// auto-load the propagation diagram in the background (deferred from the fast core pass)
async function ensureDiagram(d) {
  if (!d || d.diagram_svg) return;
  try {
    const r = await fetch("/diagram", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ species: d.species, common_name: d.common_name || "", method: d.method || "" }),
    });
    if (!r.ok) return;
    const out = await r.json();
    d.diagram_svg = out.diagram_svg || "";
    if (d === currentResult && d.diagram_svg) {
      $("plate").style.display = "block";
      $("svg").innerHTML = d.diagram_svg;
    }
    await persistResultIfSaved();
  } catch (e) { /* diagram is optional */ }
}

async function persistResultIfSaved() {
  if (!currentSaved) return;
  currentSaved.ai_result = currentResult;
  try {
    await fetch("/plants/" + currentSaved.id, {
      method: "PATCH", headers: { "Content-Type": "application/json", "X-User": me },
      body: JSON.stringify({ ai_result: currentResult }),
    });
  } catch (e) { /* keep UI */ }
}
async function savedImageBlob() {
  if (!currentSaved) return null;
  try {
    const photos = await (await fetch(`/plants/${currentSaved.id}/photos`)).json();
    const cover = photos.find((p) => p.is_cover) || photos[0];
    if (cover) return await (await fetch(`/photos/${cover.id}/full`)).blob();
  } catch (e) { /* fall through */ }
  if (currentSaved.thumbnail) {
    try { return await (await fetch(currentSaved.thumbnail)).blob(); } catch (e) { /* none */ }
  }
  return null;
}
async function runAppraise(btn) {
  const d = currentResult;
  if (btn) { btn.disabled = true; btn.textContent = "Checking value…"; }
  try {
    const r = await fetch("/appraise", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ species: d.species, common_name: d.common_name || "" }),
    });
    if (!r.ok) throw new Error();
    const out = await r.json();
    d.marketability = out.marketability;
    d.established = out.established;
    d.options = out.options || null;
    await persistResultIfSaved();
    render(d);
    const chip = $("value-chip");
    if (chip) chip.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = "💲 Check resale value — retry"; }
  }
}
async function runDiagnose(btn) {
  const d = currentResult;
  if (btn) { btn.disabled = true; btn.textContent = "Checking health…"; }
  try {
    const blob = currentSaved ? await savedImageBlob() : lastBlob;
    if (!blob) throw new Error();
    const fd = new FormData();
    fd.append("file", blob, "plant.jpg");
    fd.append("species", d.species);
    fd.append("common_name", d.common_name || "");
    const r = await fetch("/diagnose", { method: "POST", body: fd });
    if (!r.ok) throw new Error();
    const out = await r.json();
    d.diagnosis = out.diagnosis;
    await persistResultIfSaved();
    render(d);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = "🩺 Run health check-up — retry"; }
  }
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
  const chip = $("value-chip");
  if (!d.marketability) {
    $("resale-sec").style.display = "none";
    if (chip) chip.style.display = "none";
    return;
  }
  $("resale-sec").style.display = "block";
  const m = d.marketability || {};
  const e = d.established;
  if (chip) {
    chip.style.display = "block";
    chip.innerHTML = `<div class="vchip">
      <div class="vchip-row">
        <span class="vchip-icon">💲</span>
        <div class="vchip-vals">
          <div class="vchip-line"><span class="vchip-type">Cuttings</span><span class="vchip-range">${esc(m.est_price_range||"—")}</span></div>
          ${e ? `<div class="vchip-line"><span class="vchip-type">Whole plant</span><span class="vchip-range">${esc(e.est_price_range||"—")}</span></div>` : ""}
        </div>
        <div class="vchip-score">${m.score||"—"}<span class="vchip-denom">/10</span></div>
      </div>
      <div class="vchip-sub">${[cap(m.demand)+" demand", cap(m.rarity), cap(m.propagation_ease)+" to propagate"].filter(Boolean).join(" · ")}</div>
    </div>`;
  }
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
  let extra = optionsHtml(d.options);
  // Already appraised, but predates the resale-options feature — offer an in-place fill-in.
  if (!d.options && d.marketability) {
    extra = `<div class="ropts"><button class="exbtn optbtn" id="optBtn">💰 Show resale options</button></div>`;
  }
  $("resale").innerHTML = html + `</div>` + extra;
  const ob = $("optBtn");
  if (ob) ob.onclick = () => runAppraise(ob);
}

const DIFF_CLASS = { easy: "d-easy", moderate: "d-mod", hard: "d-hard" };

function optionsHtml(o) {
  if (!o || !(o.harvest_options || []).length) return "";
  let h = `<div class="ropts"><div class="ropts-h">💰 Best ways to make money on this plant</div>`;
  if (o.top_pick) h += `<div class="rtop">⭐ ${esc(o.top_pick)}</div>`;
  h += `<div class="optlist">`;
  (o.harvest_options || []).forEach((x, i) => {
    const diff = String(x.difficulty || "").toLowerCase();
    h += `<div class="optcard">
      <div class="optrow">
        <span class="optrank">${i + 1}</span>
        <span class="optname">${esc(x.method || "")}</span>
        <span class="optval">${esc(x.est_value || "—")}</span>
      </div>
      <div class="optmeta">
        <span class="diffbadge ${DIFF_CLASS[diff] || ""}">${cap(x.difficulty || "—")}</span>
        ${x.demand ? `<span class="optdot">${cap(x.demand)} demand</span>` : ""}
        ${x.effort ? `<span class="optdot">${esc(x.effort)}</span>` : ""}
        ${x.best_venue ? `<span class="optdot">📍 ${esc(x.best_venue)}</span>` : ""}
      </div>
      ${x.product ? `<div class="optsub">${esc(x.product)}</div>` : ""}
      ${x.tip ? `<div class="opttip">💡 ${esc(x.tip)}</div>` : ""}
    </div>`;
  });
  h += `</div>`;
  if ((o.venues || []).length) {
    h += `<div class="venh">Where to sell — in priority order</div><ol class="venlist">`;
    o.venues.forEach((v) => {
      h += `<li><span class="venname">${esc(v.name || "")}</span>${v.good_for ? ` — <span class="venfor">${esc(v.good_for)}</span>` : ""}${v.note ? `<div class="vennote">${esc(v.note)}</div>` : ""}</li>`;
    });
    h += `</ol>`;
  }
  return h + `</div>`;
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
    where: "All big-box: coco-coir bricks (Wonder Soil/Viagrow), perlite, and all-purpose/builder's sand at Home Depot, Lowe's, or Walmart. Coir + peat are interchangeable.",
    bulk: "Coco coir — cheapest as compressed bricks (1 kg ≈ 5 L hydrated)." },
  { key: "aroid", name: "Chunky aroid mix", ratio: "2 bark : 2 perlite : 1 coir : ½ charcoal",
    ingredients: [{ name: "Orchid bark", parts: "2" }, { name: "Perlite", parts: "2" }, { name: "Coco coir", parts: "1" }, { name: "Horticultural charcoal", parts: "½" }],
    suits: ["Monstera", "Pothos", "Philodendron", "Syngonium", "Rhaphidophora", "Anthurium", "Alocasia"],
    method: "Pre-hydrate the coir, then toss everything to a uniform chunky texture — one mix top to bottom, no drainage layer. Push bark higher for epiphytic Anthurium; go a touch finer/moister for crawling philodendrons.",
    storage: "Dry & sealed; shake dust off the bark first. Bark lasts ~18–24 months.",
    where: "All from Home Depot/Lowe's/Walmart — bagged 'orchid bark', perlite, coco-coir bricks, and Mosser Lee horticultural charcoal (charcoal is optional, just keeps the mix fresh).",
    bulk: "Orchid bark — biggest volume and degrades fastest, so highest turnover. This is the hot seller." },
  { key: "succulent", name: "Succulent & cactus (gritty)", ratio: "1 soil : 1 sand : 1 perlite",
    ingredients: [{ name: "Potting soil or coir", parts: "1" }, { name: "Coarse sand", parts: "1" }, { name: "Perlite", parts: "1" }],
    suits: ["Echeveria", "Aloe", "Haworthia", "Sedum", "Sempervivum", "Jade", "Cacti"],
    method: "Mix dry to a light, gritty texture water runs straight through. Use all-purpose/builder's sand — never fine play sand. For true desert cacti push grit to 2 mineral : 1 organic.",
    storage: "Stores well dry & compact; re-fluff before bagging.",
    where: "All big-box — bagged potting soil, perlite, and all-purpose/builder's sand from the masonry aisle. (Pumice is a heavier, non-floating upgrade if you order it online — not required.)",
    bulk: "All-purpose/builder's sand by the bag (cheapest); pumice is a premium, reusable upgrade if you order online." },
  { key: "seed", name: "Seed-starting / propagation", ratio: "1 coir : 1 perlite : 1 vermiculite",
    ingredients: [{ name: "Coco coir (or peat)", parts: "1" }, { name: "Perlite", parts: "1" }, { name: "Vermiculite", parts: "1" }],
    suits: ["Seeds", "Soft cuttings", "Coleus", "Tradescantia", "Herbs"],
    method: "Pre-wet coir & vermiculite, blend, moisten before sowing. Deliberately fine and LOW-nutrient so tender new roots don't burn. For cuttings, just coir + perlite.",
    storage: "Sealed, slightly dry; pasteurize first if it contains any compost (prevents damping-off).",
    where: "All big-box — coco coir, perlite, and vermiculite are garden-aisle staples at Home Depot, Lowe's, and Walmart.",
    bulk: "Coco coir — compressed bricks are the value form." },
  { key: "orchid", name: "Orchid bark (4:1:1)", ratio: "4 bark : 1 perlite : 1 charcoal",
    ingredients: [{ name: "Orchid / fir bark", parts: "4" }, { name: "Perlite", parts: "1" }, { name: "Horticultural charcoal", parts: "1" }],
    suits: ["Phalaenopsis", "Cattleya", "Dendrobium", "Oncidium", "Miltonia"],
    method: "Soak the bark briefly so it isn't hydrophobic, combine, pot loosely for air gaps. Never use regular soil — it suffocates and rots orchid roots.",
    storage: "Don't stockpile — bark mixes break down; replace every ~2 years.",
    where: "All big-box — bagged 'orchid bark' or 'orchid mix', perlite, and Mosser Lee/Espoma charcoal at Home Depot, Lowe's, or Walmart.",
    bulk: "Fir/orchid bark — it's 80%+ of the mix." },
  { key: "hoya", name: "Hoya / epiphyte", ratio: "5 bark : 2 perlite : 2 coir : ½ charcoal : ½ castings",
    ingredients: [{ name: "Orchid bark", parts: "5" }, { name: "Perlite", parts: "2" }, { name: "Coco coir", parts: "2" }, { name: "Charcoal", parts: "½" }, { name: "Worm castings", parts: "½" }],
    suits: ["Hoya", "Epiphytes"],
    method: "Pre-hydrate coir, then mix into the bark with perlite, charcoal and castings. Chunkier than an aroid mix so roots dry fast — epiphytes rot if kept wet. Simple version: 2 bark : 2 perlite : 1 coir.",
    storage: "Cool, dry, sealed; keep castings dry (they clump). Bark ~18 months.",
    where: "All big-box — orchid bark, perlite, coir, charcoal, and worm castings (Wiggle Worm/Viagrow) at Home Depot/Lowe's/Walmart. Charcoal + castings are optional boosters.",
    bulk: "Orchid bark — half the mix." },
  { key: "calathea", name: "Calathea / prayer plant", ratio: "2 coir : 1 fine bark : 1 perlite",
    ingredients: [{ name: "Coco coir (or peat)", parts: "2" }, { name: "Fine bark", parts: "1" }, { name: "Perlite", parts: "1" }],
    suits: ["Calathea", "Maranta", "Stromanthe", "Ctenanthe"],
    method: "Hydrate coir, fold in bark & perlite (a pinch of castings + charcoal optional). Should feel spongy yet crumbly with visible air pockets — steady moisture without sogginess.",
    storage: "Use relatively fresh — high organic content compacts; refresh yearly.",
    where: "All big-box — coco coir, perlite, and bagged orchid bark (just sift out the fines, or crush a handful) at Home Depot, Lowe's, or Walmart.",
    bulk: "Coco coir — the dominant fraction and moisture buffer." },
  { key: "fern", name: "Fern / moisture-lover", ratio: "1 coir : 1 vermiculite : 1 sphagnum",
    ingredients: [{ name: "Coco coir (or peat)", parts: "1" }, { name: "Vermiculite", parts: "1" }, { name: "Sphagnum moss", parts: "1" }, { name: "Charcoal", parts: "1 Tbsp/qt" }],
    suits: ["Boston fern", "Maidenhair", "Bird's nest", "Staghorn"],
    method: "Blend evenly, add charcoal to keep the constantly-damp mix sweet, pre-moisten. Vermiculite (not perlite) is chosen for higher water-holding.",
    storage: "Sealed and barely damp; sphagnum/peat dry into hard pucks if left open. Refresh yearly.",
    where: "All big-box — coco coir, vermiculite, sphagnum moss (Mosser Lee), and charcoal at Home Depot, Lowe's, or Walmart.",
    bulk: "Vermiculite — the moisture workhorse here." },
  { key: "herb", name: "Herb / vegetable", ratio: "2 compost : 1 coir : 1 perlite",
    ingredients: [{ name: "Compost", parts: "2" }, { name: "Coco coir (or peat)", parts: "1" }, { name: "Perlite", parts: "1" }],
    suits: ["Basil", "Parsley", "Thyme", "Mint", "Tomato", "Pepper", "Lettuce"],
    method: "Mix with lime (if peat) and a balanced organic fertilizer — edibles are hungry feeders. Moisten before potting.",
    storage: "Compost is alive — use within a season or two; store sealed but breathable, not airtight-wet.",
    where: "All big-box — bagged compost or composted manure, coco coir, and perlite at Home Depot, Lowe's, or Walmart.",
    bulk: "Compost — cheapest by the bag or yard." },
  { key: "violet", name: "African violet / begonia", ratio: "2 coir : 1 perlite : 1 vermiculite",
    ingredients: [{ name: "Coco coir (or peat)", parts: "2" }, { name: "Perlite", parts: "1" }, { name: "Vermiculite", parts: "1" }],
    suits: ["African violet", "Streptocarpus", "Episcia", "Begonia"],
    method: "Blend to a loose, fluffy, crumbly texture; add dolomite lime to pH 6.5–6.8. Airy, not dense. For wick-watering, push perlite to 50–60% and drop the vermiculite.",
    storage: "Stores well sealed & dry; high perlite fraction resists compaction.",
    where: "All big-box — coco coir, perlite, and vermiculite at Home Depot, Lowe's, or Walmart. Dolomite lime is in the same garden aisle.",
    bulk: "Coarse perlite — 25–60% of the mix." },
];

const GUIDES = [
  { key: "bulk", name: "Where & how to buy components", lines: [
    "One-trip starter list (Home Depot / Lowe's / Walmart): a bag each of perlite, vermiculite, coco-coir bricks, orchid bark, and all-purpose potting soil covers ~80% of these mixes.",
    "Perlite & vermiculite — garden-aisle staples; the big 2–4 cu ft bags are cheapest per litre. ⚠️ Wet perlite before handling; the dust is a lung irritant.",
    "Coco coir — buy compressed bricks (Wonder Soil, Viagrow), not loose bags. 1 kg ≈ 5 L once soaked (30–60 min, warm water). Look for rinsed/buffered low-EC coir.",
    "Orchid bark — bagged 'orchid bark' or 'orchid mix' at any big-box garden center. Breaks down in 1–3 yrs, so don't over-stock; keep dry or it molds.",
    "Charcoal, sphagnum moss & worm castings — garden-aisle brands like Mosser Lee, Espoma, and Wiggle Worm. Castings' microbes fade after 6–12 months, so buy what you'll use.",
    "Sand — all-purpose / builder's / paver sand from the masonry aisle (never fine play sand). ⚠️ Keep damp and wear a mask — silica dust.",
    "Going bigger or premium: pumice (heavier, reusable — order online or at hydroponic shops), or buy perlite/coir/bark in contractor-size bags from a grower supplier for 50%+ savings.",
  ] },
  { key: "storage", name: "Storing soil & components", lines: [
    "Dry storage is the #1 rule — fungus gnats and mold need moist organic media. Dry mixes & components before sealing (not powder-dry, just dry).",
    "Use sealed rigid bins with tight lids — a bag clip isn't enough. One bin per raw component + one per finished blend = clean inventory.",
    "Keep them cool, dry and low-humidity. Heat + damp speed mold and breakdown.",
    "Use only pasteurized/fully-composted ingredients; more perlite/pumice/bark resists gnats. Sterilize bins with 1:9 bleach:water (30 min), rinse, dry.",
    "Label every bag: mix name · volume (cups) · date made · full ingredients · plant suitability · a quick use note.",
  ] },
];

// canonical components for the "what do you have?" grid
const COMPONENTS = [
  ["perlite", "Perlite"], ["pumice", "Pumice"], ["bark", "Orchid bark"], ["coir", "Coco coir"],
  ["peat", "Peat moss"], ["vermiculite", "Vermiculite"], ["charcoal", "Charcoal"], ["castings", "Worm castings"],
  ["sand", "Coarse sand"], ["compost", "Compost"], ["sphagnum", "Sphagnum"], ["potting", "Potting soil"],
];
// map a recipe ingredient name -> the canonical components that can satisfy it
function ingredientComponents(name) {
  const s = String(name || "").toLowerCase();
  const hits = [];
  if (s.includes("perlite")) hits.push("perlite");
  if (s.includes("pumice")) hits.push("pumice");
  if (s.includes("bark")) hits.push("bark");
  if (s.includes("coir")) hits.push("coir");
  if (s.includes("peat")) hits.push("peat");
  if (s.includes("vermiculite")) hits.push("vermiculite");
  if (s.includes("charcoal")) hits.push("charcoal");
  if (s.includes("casting")) hits.push("castings");
  if (s.includes("sand")) hits.push("sand");
  if (s.includes("compost")) hits.push("compost");
  if (s.includes("sphagnum") || s.includes("moss")) hits.push("sphagnum");
  if (s.includes("potting")) hits.push("potting");
  return [...new Set(hits)];
}
// hand-authored soil substitutions: component -> {sub, note, clean (1:1) | not}
const SUBS = {
  perlite: { sub: "pumice", note: "Same drainage — pumice is heavier and won't float to the top.", clean: true },
  pumice: { sub: "perlite", note: "Same drainage — perlite is lighter and may float up over time.", clean: true },
  peat: { sub: "coir", note: "Coir is the renewable swap, ~1:1 for moisture.", clean: true },
  coir: { sub: "peat", note: "Both hold water; peat is acidic — add a pinch of lime.", clean: true },
  vermiculite: { sub: "perlite", note: "⚠ Perlite DRAINS where vermiculite HOLDS water — the mix runs drier.", clean: false },
  bark: { sub: "pumice", note: "Keeps it chunky & airy, but loses bark's big root pockets.", clean: false },
  sand: { sub: "pumice", note: "Both add grit/drainage; pumice holds a touch more water.", clean: false },
  castings: { sub: "compost", note: "Both feed gently; compost is coarser — use a bit less.", clean: false },
  sphagnum: { sub: "coir", note: "Both hold moisture; coir is finer and re-wets easier.", clean: false },
  compost: { sub: "castings", note: "Richer per scoop — use less.", clean: false },
  potting: { sub: "coir", note: "Coir + a little compost approximates basic potting soil.", clean: false },
  charcoal: { sub: "", note: "Optional — safe to leave out.", clean: true },
};

let pantry = {}; // component key -> "have" | "exclude" (absent = don't have)

let soilView = "recipes";
let soilPacks = [];
let currentSoil = null;
let customRecipes = []; // household-authored recipes from the server

async function loadCustomRecipes() {
  try { customRecipes = await (await fetch("/recipes")).json(); }
  catch (e) { customRecipes = []; }
}
// built-in + custom, normalized to one shape for pickers/snapshots
function allRecipes() {
  const custom = customRecipes.map((r) => ({
    id: r.id, name: r.name, ratio: r.ratio, ingredients: r.ingredients || [],
    suits: r.suits || [], note: r.note || "", custom: true, owner: r.owner,
  }));
  const builtin = RECIPES.map((r) => ({
    key: r.key, name: r.name, ratio: r.ratio, ingredients: r.ingredients || [],
    suits: r.suits || [], note: r.method || "", custom: false,
  }));
  return custom.concat(builtin);
}

async function loadSoil() {
  await loadCustomRecipes();
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

/* ---------- global profit (Market → Profit): plant ROI + soil calc ---------- */
const money = (n) => (n < 0 ? "−$" : "$") + Math.abs(n).toFixed(2);
const range$ = (a, b) => (a === b ? money(a) : `${money(a)}–${money(b)}`);

let marketView = "listings";
function showMarketView(v) {
  marketView = v;
  $("market-listings").style.display = v === "listings" ? "block" : "none";
  $("market-profit").style.display = v === "profit" ? "block" : "none";
  document.querySelectorAll("#market-toggle button").forEach((b) => b.classList.toggle("on", b.dataset.mkt === v));
  if (v === "listings") loadMarket();
  if (v === "profit") renderProfit();
}

async function renderProfit() {
  const box = $("market-profit");
  box.innerHTML = `<div class="empty">Loading…</div>`;
  let plants = [];
  if (me) {
    try { plants = await (await fetch("/plants/mine", { headers: { "X-User": me } })).json(); } catch (e) { /* empty */ }
  }
  let invested = 0, potMin = 0, potMax = 0;
  const rows = plants.map((p) => {
    const a = p.ai_result || {}, m = a.marketability || {}, e = a.established || null;
    const cut = parseRange(m.est_price_range);
    const pot = e ? parseRange(e.est_price_range) : [0, 0];
    const cost = p.cost || 0;
    invested += cost; potMin += pot[0]; potMax += pot[1];
    return { name: p.nickname || p.common_name || p.species, cost, cut, pot, sold: p.sold };
  });
  const roiRows = rows.length
    ? rows.map((r) => `<div class="roi">
        <div><div class="rn2">${esc(r.name)}</div>
          <div class="rsub2">Paid ${money(r.cost)}${r.cut[1] ? ` · cuttings ${range$(r.cut[0], r.cut[1])}/ea` : ""}</div></div>
        <div class="rprof"><div>pot &amp; sell</div><div class="rp">${range$(r.pot[0] - r.cost, r.pot[1] - r.cost)}</div></div>
      </div>`).join("")
    : `<div class="galempty">No saved plants yet. Save a plant and set <b>What we paid</b> on it.</div>`;
  const netMin = potMin - invested, netMax = potMax - invested;
  box.innerHTML =
    `<h3 class="sec-h">Plant ROI — buy → pot &amp; sell</h3>${roiRows}` +
    `<div class="calc-out" style="border:none;margin-top:8px">
       <div class="calc-row"><span>Total invested (${rows.length})</span><b>${money(invested)}</b></div>
       <div class="calc-row"><span>Whole-plant potential</span><b>${range$(potMin, potMax)}</b></div>
       <div class="calc-profit ${netMax >= 0 ? "pos" : "neg"}"><span class="pl">Potential profit</span><span class="pv">${range$(netMin, netMax)}</span></div>
       <div class="calc-margin">selling them all potted, after what you paid</div>
     </div>` +
    `<h3 class="sec-h" style="margin-top:24px">Soil batch calculator</h3>
     <div class="calc">
       <label>Total materials cost ($)</label>
       <input id="cMat" type="number" inputmode="decimal" placeholder="e.g. 18" />
       <div class="two">
         <div><label>Bags you'll make</label><input id="cBags" type="number" inputmode="numeric" placeholder="e.g. 12" /></div>
         <div><label>Price per bag ($)</label><input id="cPrice" type="number" inputmode="decimal" placeholder="e.g. 9" /></div>
       </div>
       <div class="calc-out" id="cOut"></div>
     </div>`;
  ["cMat", "cBags", "cPrice"].forEach((id) => ($(id).oninput = calcProfit));
  calcProfit();
}
function calcProfit() {
  const mat = parseFloat($("cMat").value) || 0;
  const bags = parseFloat($("cBags").value) || 0;
  const price = parseFloat($("cPrice").value) || 0;
  const revenue = bags * price;
  const profit = revenue - mat;
  const margin = revenue > 0 ? Math.round((profit / revenue) * 100) : 0;
  const perBag = bags > 0 ? profit / bags : 0;
  $("cOut").innerHTML =
    `<div class="calc-row"><span>Revenue (${bags || 0} × ${money(price)})</span><b>${money(revenue)}</b></div>` +
    `<div class="calc-row"><span>Materials</span><b>−${money(mat)}</b></div>` +
    `<div class="calc-row"><span>Profit per bag</span><b>${money(perBag)}</b></div>` +
    `<div class="calc-profit ${profit >= 0 ? "pos" : "neg"}"><span class="pl">${profit >= 0 ? "Profit" : "Loss"}</span><span class="pv">${money(profit)}</span></div>` +
    `<div class="calc-margin">${revenue > 0 ? margin + "% margin" : "&nbsp;"}</div>`;
}

// per-ingredient status against the current pantry
function ingredientStatus(name) {
  const comps = ingredientComponents(name);
  if (!comps.length) return { state: "have" }; // generic (e.g. potting soil) — assume on hand
  if (comps.some((c) => pantry[c] === "have")) return { state: "have" };
  // need a swap: a candidate that's missing/excluded -> use its sub if you HAVE that sub
  for (const c of comps) {
    const s = SUBS[c];
    if (s && s.sub && pantry[s.sub] === "have") return { state: "swap", from: c, to: s.sub, note: s.note, clean: s.clean };
  }
  const c0 = comps[0], s0 = SUBS[c0] || {};
  return { state: "missing", from: c0, to: s0.sub, note: s0.note, clean: s0.clean };
}
function recipeMatch(r) {
  const items = r.ingredients.map((i) => ({ i, st: ingredientStatus(i.name) }));
  return { items, missing: items.filter((x) => x.st.state === "missing").length, swaps: items.filter((x) => x.st.state === "swap").length };
}
const compName = (k) => (COMPONENTS.find((c) => c[0] === k) || [k, k])[1];

function renderRecipes() {
  const box = $("soil-recipes");
  const active = Object.keys(pantry).length > 0;
  // sync bar
  const synced = localStorage.getItem("rootwork_recipe_sync");
  const syncWhen = synced ? `Checked ${timeAgo(+synced)}` : "Never checked";
  const sync = `<div class="syncbar"><button class="exportbtn" id="syncBtn">↻ Sync recipes</button><span class="syncwhen">${syncWhen}</span></div>
    <div id="syncOut"></div>`;
  // "what do you have?" pantry grid (tri-state: have / exclude / none)
  const chips = COMPONENTS.map(([k, l]) => {
    const st = pantry[k] || "";
    return `<button class="pchip ${st}" data-comp="${k}">${st === "have" ? "✓ " : st === "exclude" ? "⊘ " : ""}${esc(l)}</button>`;
  }).join("");
  const pantryUI = `<div class="rsub" style="margin:16px 0 6px">What do you have? <span style="text-transform:none;letter-spacing:0;color:var(--sepia)">— tap: have → exclude → off</span></div>
    <div class="pantry">${chips}</div>${active ? `<button class="link" id="pantryClear" style="margin-top:8px">Clear</button>` : ""}`;
  // guides
  const guides = GUIDES.map((g) => `<div class="recipe" data-key="g-${g.key}">
      <div class="recipe-h"><div class="rn">${esc(g.name)}</div><span class="chev">▾</span></div>
      <div class="recipe-body">${g.lines.map((l) => `<div class="rtip" style="margin-top:8px">${esc(l)}</div>`).join("")}</div>
    </div>`).join("");
  // recipes (re-ranked + substitutions when pantry active)
  let list = RECIPES.map((r) => ({ r, m: active ? recipeMatch(r) : null }));
  if (active) list.sort((a, b) => a.m.missing - b.m.missing);
  const recipes = list.map(({ r, m }) => {
    const ings = (m ? m.items : r.ingredients.map((i) => ({ i, st: { state: "plain" } }))).map(({ i, st }) => {
      let label = esc(i.name);
      if (st.state === "swap") label = `<s>${esc(compName(st.from))}</s> → <b>${esc(compName(st.to))}</b> <span class="subbadge ${st.clean ? "clean" : "chg"}">SUB · ${st.clean ? "same job" : "changes feel"}</span>`;
      else if (st.state === "missing") label = `${esc(i.name)} <span class="miss">missing</span>${st.to ? ` <span class="subhint">or ${esc(compName(st.to))}</span>` : ""}`;
      return `<div class="ing"><span>${label}</span><b>${esc(i.parts)}</b></div>`;
    }).join("");
    const badge = m
      ? (m.missing === 0 ? `<span class="rstatus ready">Ready${m.swaps ? " · w/ subs" : ""}</span>` : `<span class="rstatus miss">Missing ${m.missing}</span>`)
      : `<span class="rmeta">${esc(r.ratio)}</span>`;
    const subNotes = m ? m.items.filter((x) => x.st.note && (x.st.state === "swap" || x.st.state === "missing")).map((x) => `<div class="rtip" style="margin-top:4px">↳ ${esc(compName(x.st.from))}: ${esc(x.st.note)}</div>`).join("") : "";
    return `<div class="recipe${m && m.missing === 0 ? " ok" : ""}" data-key="${r.key}">
      <div class="recipe-h"><div><div class="rn">${esc(r.name)}</div>${badge}</div><span class="chev">▾</span></div>
      <div class="recipe-body">
        <div class="rsub">Mix (parts by volume)</div>${ings}${subNotes}
        ${r.where ? `<div class="rsub">Where to buy</div><div class="rtip">${esc(r.where)}</div>` : ""}
        <div class="rsub">Good for</div><div class="suits">${r.suits.map((s) => `<span>${esc(s)}</span>`).join("")}</div>
        <div class="rsub">How</div><div class="rtip">${esc(r.method)}</div>
        <div class="rsub">Storage</div><div class="rtip">${esc(r.storage)}</div>
        <div class="rsub">Buy in bulk</div><div class="rtip">${esc(r.bulk)}</div>
        <button class="makebtn" data-make="${r.key}">＋ Make a batch from this</button>
      </div></div>`;
  }).join("");
  // custom (household-authored) recipes — editable/deletable by their owner
  const customCards = customRecipes.map((r) => {
    const ings = (r.ingredients || []).map((i) => `<div class="ing"><span>${esc(i.name)}</span><b>${esc(i.parts || "")}</b></div>`).join("");
    const mine = r.owner === me;
    const who = (memberBy(r.owner) || {}).display_name || "";
    return `<div class="recipe" data-key="c-${r.id}">
      <div class="recipe-h"><div><div class="rn">${esc(r.name)}${who ? `<span class="mineflag">· ${esc(who)}</span>` : ""}</div><span class="rmeta">${esc(r.ratio || "")}</span></div><span class="chev">▾</span></div>
      <div class="recipe-body">
        ${ings ? `<div class="rsub">Mix (parts by volume)</div>${ings}` : ""}
        ${(r.suits && r.suits.length) ? `<div class="rsub">Good for</div><div class="suits">${r.suits.map((s) => `<span>${esc(s)}</span>`).join("")}</div>` : ""}
        ${r.note ? `<div class="rsub">How</div><div class="rtip">${esc(r.note)}</div>` : ""}
        <button class="makebtn" data-cmake="${r.id}">＋ Make a batch from this</button>
        ${mine ? `<div class="rmanage"><button data-cedit="${r.id}">✎ Edit</button><button class="rdel" data-cdel="${r.id}">Delete</button></div>` : ""}
      </div></div>`;
  }).join("");
  const yourSection =
    `<div class="rsub" style="margin:18px 0 8px">Your recipes</div>` +
    `<button class="recnew" id="recNew">＋ New recipe</button>` +
    (customCards || `<div class="rtip" style="margin-bottom:6px">No custom recipes yet — tap ＋ New recipe, or save one from a plant's Soil section.</div>`);
  box.innerHTML = sync + pantryUI +
    `<div class="rsub" style="margin:18px 0 8px">Maker's guide</div>${guides}` +
    yourSection +
    `<div class="rsub" style="margin:18px 0 8px">${active ? "Built-in recipes — ranked by what you have" : "Built-in recipes — pick the right blend per plant"}</div>${recipes}`;
  $("syncBtn").onclick = runRecipeSync;
  $("recNew").onclick = () => openRecipeEditor(null, {});
  if ($("pantryClear")) $("pantryClear").onclick = () => { pantry = {}; renderRecipes(); };
  box.querySelectorAll("[data-comp]").forEach((b) => (b.onclick = () => cyclePantry(b.dataset.comp)));
  box.querySelectorAll(".recipe-h").forEach((h) => (h.onclick = () => h.parentElement.classList.toggle("open")));
  box.querySelectorAll("[data-make]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); makePack(b.dataset.make); }));
  box.querySelectorAll("[data-cmake]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); makeCustomPack(+b.dataset.cmake); }));
  box.querySelectorAll("[data-cedit]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openRecipeEditor(customRecipes.find((x) => x.id === +b.dataset.cedit), {}); }));
  box.querySelectorAll("[data-cdel]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); deleteCustomRecipe(+b.dataset.cdel); }));
}

/* ---------- custom recipe CRUD + editor + per-plant blend picker ---------- */
async function createRecipe(body) {
  try {
    const r = await fetch("/recipes", { method: "POST", headers: { "Content-Type": "application/json", "X-User": me }, body: JSON.stringify(body) });
    if (r.ok) return await r.json();
  } catch (e) { /* fall through */ }
  alert("Couldn't save that recipe — try again.");
  return null;
}
async function patchRecipe(id, body) {
  try { await fetch("/recipes/" + id, { method: "PATCH", headers: { "Content-Type": "application/json", "X-User": me }, body: JSON.stringify(body) }); }
  catch (e) { /* keep UI */ }
}
async function deleteCustomRecipe(id) {
  if (!confirm("Delete this recipe? (Plants already using it keep their saved copy.)")) return;
  try { await fetch("/recipes/" + id, { method: "DELETE", headers: { "X-User": me } }); } catch (e) { /* ignore */ }
  await loadCustomRecipes();
  renderRecipes();
}
async function makeCustomPack(id) {
  if (!me) return showPicker();
  const r = customRecipes.find((x) => x.id === id);
  if (!r) return;
  const pack = await postSoil({
    name: r.name, recipe_key: "custom", size: "1 Quart",
    recipe: { ingredients: r.ingredients || [], suits: r.suits || [] }, visibility: "family", in_market: false,
  });
  if (pack) { setSoilView("packs"); openSoil(pack); }
}

function closeRecipeSheet() { $("recipeSheet").classList.remove("on"); recipeEditCtx = null; }
let recipeEditCtx = null;

function ingRowHtml(i) {
  return `<div class="ingrow"><input type="text" class="iname" value="${esc(i.name || "")}" placeholder="Ingredient"><input type="text" class="iparts" value="${esc(i.parts || "")}" placeholder="parts"><button class="ingdel" type="button" aria-label="remove">✕</button></div>`;
}
function wireIngDel(row) { const b = row.querySelector(".ingdel"); if (b) b.onclick = () => row.remove(); }

function openRecipeEditor(existing, opts = {}) {
  if (!me) return showPicker();
  // Starting a fresh per-plant blend: pre-fill with the app's suggestion so it's "edit", not "from scratch".
  if (!existing && opts.forPlant && currentResult && currentResult.care) {
    existing = { ratio: currentResult.care.soil_short || "", note: currentResult.care.soil_diy || "" };
  }
  recipeEditCtx = { id: existing && existing.id ? existing.id : null, forPlant: !!opts.forPlant, linkedRecipeId: opts.linkedRecipeId || null };
  const e = existing || {};
  const ings = (e.ingredients && e.ingredients.length) ? e.ingredients : [{ name: "", parts: "" }];
  const title = recipeEditCtx.id ? "Edit recipe" : (opts.forPlant ? "Your blend for this plant" : "New recipe");
  const sub = opts.forPlant
    ? "This replaces the app's soil suggestion for this plant. Your blend shows above it."
    : "Saved to your Soil Lab and shared with the family.";
  $("recipeBody").innerHTML = `<div class="sheet-h">${title}</div>
    <div class="sheet-sub">${sub}</div>
    <div class="rform">
      <label>Name</label><input type="text" id="rfName" value="${esc(e.name || "")}" placeholder="e.g. My chunky aroid v2">
      <label>Ratio (one line)</label><input type="text" id="rfRatio" value="${esc(e.ratio || "")}" placeholder="e.g. 2 bark : 2 perlite : 1 coir">
      <label>Ingredients (optional)</label>
      <div id="rfIngs">${ings.map(ingRowHtml).join("")}</div>
      <button class="ingadd" id="rfIngAdd" type="button">＋ Add ingredient</button>
      <label>Good for (optional, comma-separated)</label><input type="text" id="rfSuits" value="${esc((e.suits || []).join(", "))}" placeholder="Monstera, Pothos">
      <label>Notes / how-to (optional)</label><textarea id="rfNote" placeholder="Mixing tips, why this works…">${esc(e.note || "")}</textarea>
      ${opts.forPlant ? `<label class="savecheck"><input type="checkbox" id="rfSave" checked> ${opts.linkedRecipeId ? "Also update the saved recipe in Soil Lab" : "Also save to Soil Lab (reuse on other plants)"}</label>` : ""}
      <button class="rsave" id="rfSaveBtn" type="button">Save${opts.forPlant ? " blend" : " recipe"}</button>
      <button class="rcancel" id="rfCancel" type="button">Cancel</button>
    </div>`;
  $("recipeSheet").classList.add("on");
  $("rfIngs").querySelectorAll(".ingrow").forEach(wireIngDel);
  $("rfIngAdd").onclick = () => {
    const d = document.createElement("div");
    d.innerHTML = ingRowHtml({ name: "", parts: "" });
    const row = d.firstElementChild;
    $("rfIngs").appendChild(row);
    wireIngDel(row);
  };
  $("rfSaveBtn").onclick = saveRecipeForm;
  $("rfCancel").onclick = closeRecipeSheet;
}

function collectRecipeForm() {
  const ingredients = [...$("rfIngs").querySelectorAll(".ingrow")]
    .map((r) => ({ name: r.querySelector(".iname").value.trim(), parts: r.querySelector(".iparts").value.trim() }))
    .filter((i) => i.name);
  return {
    name: $("rfName").value.trim(),
    ratio: $("rfRatio").value.trim(),
    ingredients,
    suits: $("rfSuits").value.split(",").map((s) => s.trim()).filter(Boolean),
    note: $("rfNote").value.trim(),
  };
}
async function saveRecipeForm() {
  const body = collectRecipeForm();
  if (!body.name) { $("rfName").focus(); return; }
  const ctx = recipeEditCtx;
  const btn = $("rfSaveBtn"); btn.disabled = true; btn.textContent = "Saving…";
  if (ctx.forPlant) {
    const snapshot = { name: body.name, ratio: body.ratio, ingredients: body.ingredients, suits: body.suits, note: body.note, source: "custom" };
    const doSave = $("rfSave") && $("rfSave").checked;
    if (doSave && ctx.linkedRecipeId) {
      await patchRecipe(ctx.linkedRecipeId, body);  // edit the linked recipe in place
      snapshot.source = "recipe"; snapshot.recipe_id = ctx.linkedRecipeId;
    } else if (doSave) {
      const rc = await createRecipe(body);
      if (rc) { snapshot.source = "recipe"; snapshot.recipe_id = rc.id; }
    }
    await setPlantBlend(snapshot);
    closeRecipeSheet();
    return;
  }
  if (ctx.id) await patchRecipe(ctx.id, body);
  else await createRecipe(body);
  await loadCustomRecipes();
  closeRecipeSheet();
  renderRecipes();
}

async function openBlendPicker() {
  if (!me) return showPicker();
  if (!currentResult) return;
  await loadCustomRecipes();
  const recs = allRecipes();
  const rows = recs.map((r, i) => `<div class="rpick" data-link="${i}">
      <div><div class="rpn">${esc(r.name)}</div><div class="rpr">${esc(r.ratio || "")}</div></div>
      <span class="rptag"${r.custom ? "" : ' style="color:var(--sepia);border-color:var(--rule)"'}>${r.custom ? "Yours" : "Built-in"}</span>
    </div>`).join("");
  $("recipeBody").innerHTML = `<div class="sheet-h">Set your blend</div>
    <div class="sheet-sub">Pick one of your saved recipes for this plant, or type a quick custom blend. It shows above the app's suggestion.</div>
    <button class="recnew" id="blendNew" type="button">＋ Type a new custom blend</button>
    <div class="divlabel">Link a saved recipe</div>${rows}`;
  $("recipeSheet").classList.add("on");
  $("blendNew").onclick = () => openRecipeEditor(null, { forPlant: true });
  $("recipeBody").querySelectorAll("[data-link]").forEach((el) => (el.onclick = () => linkRecipeToPlant(recs[+el.dataset.link])));
}
function linkRecipeToPlant(r) {
  if (!r) return;
  const snapshot = { name: r.name, ratio: r.ratio, ingredients: r.ingredients || [], note: r.note || "", source: r.custom ? "recipe" : "builtin" };
  if (r.custom) snapshot.recipe_id = r.id; else snapshot.recipe_key = r.key;
  setPlantBlend(snapshot);
  closeRecipeSheet();
}
async function setPlantBlend(snapshot) {
  if (!currentResult) return;
  currentResult.care = currentResult.care || {};
  currentResult.care.soil_custom = snapshot;
  await persistResultIfSaved();
  render(currentResult);
}
function blendAction(kind) {
  if (kind === "remove") {
    if (currentResult && currentResult.care) {
      currentResult.care.soil_custom = null;
      persistResultIfSaved();
      render(currentResult);
    }
    return;
  }
  if (kind === "edit") {
    const cu = currentResult && currentResult.care && currentResult.care.soil_custom;
    if (cu) return openRecipeEditor(cu, { forPlant: true, linkedRecipeId: cu.recipe_id || null });
  }
  openBlendPicker(); // "set" — pick a recipe or type a new one
}
function cyclePantry(k) {
  pantry[k] = pantry[k] === "have" ? "exclude" : pantry[k] === "exclude" ? undefined : "have";
  if (!pantry[k]) delete pantry[k];
  renderRecipes();
}
function timeAgo(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.floor(h / 24)} day(s) ago`;
}

async function runRecipeSync() {
  const btn = $("syncBtn"), out = $("syncOut");
  btn.disabled = true; btn.textContent = "↻ Checking the web…";
  out.innerHTML = "";
  try {
    const summary = RECIPES.map((r) => `${r.name}: ${r.ratio}`).join("; ");
    const r = await fetch("/recipes/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipes: summary }) });
    if (!r.ok) throw new Error();
    const d = await r.json();
    localStorage.setItem("rootwork_recipe_sync", String(Date.now()));
    const props = (d.proposals || []).map((p) => `<div class="prop">
      <div class="prop-h">${esc(p.recipe || "General")}</div>
      <div class="prop-c">${esc(p.change || "")}</div>
      ${p.why ? `<div class="prop-w">${esc(p.why)}</div>` : ""}
      ${p.source ? `<div class="prop-s">${esc(p.source)}</div>` : ""}
    </div>`).join("");
    out.innerHTML = `<div class="syncres"><div class="syncsum">${esc(d.summary || "Checked.")}</div>${props || `<div class="rtip">No changes suggested — your recipes look current. 🌿</div>`}<div class="rtip" style="margin-top:8px;color:var(--sepia)">Suggestions only — review before changing anything.</div></div>`;
  } catch (e) {
    out.innerHTML = `<div class="rtip" style="color:var(--danger-d)">Couldn't reach the web to sync right now — try again later.</div>`;
  }
  btn.disabled = false; btn.textContent = "↻ Sync recipes";
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
    name: r.name, recipe_key: r.key, size: "1 Quart",
    recipe: { ingredients: r.ingredients, suits: r.suits }, visibility: "family", in_market: false,
  });
  if (btn) { btn.disabled = false; btn.textContent = "＋ Make a batch from this"; }
  if (pack) { setSoilView("packs"); openSoil(pack); }
}
async function newCustomPack() {
  if (!me) return showPicker();
  const name = prompt("Name this mix (e.g. 'My custom aroid blend'):");
  if (!name) return;
  const pack = await postSoil({ name, recipe_key: "custom", size: "1 Quart", recipe: {}, visibility: "family", in_market: false });
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
const SOIL_SIZES = ["1 Quart", "2 Quarts", "3 Quarts", "4 Quarts", "1 Gallon", "2 Gallons", "3 Gallons", "4 Gallons"];
function sizeToGallons(size) {
  const s = String(size || "").toLowerCase();
  const n = parseFloat(s) || 1;
  if (s.includes("gallon")) return n;
  return n * 0.25; // quarts (default)
}
function perGallon(priceRange, size) {
  const g = sizeToGallons(size);
  const [a, b] = parseRange(priceRange);
  if (!g || !b) return "";
  return a === b ? money(a / g) : `${money(a / g)}–${money(b / g)}`;
}
async function soilReappraise() {
  try {
    const r = await fetch("/soil/appraise", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: currentSoil.name, size: currentSoil.size, recipe: currentSoil.recipe }),
    });
    if (r.ok) await soilPatch({ market: await r.json() });
  } catch (e) { /* keep value */ }
}
async function soilSizeChanged(size) {
  const um = $("soilUpdating");
  if (um) um.textContent = "Updating value for the new size…";
  await soilPatch({ size }, false);
  await soilReappraise(); // re-renders with the size-correct price + $/gal
}

function renderSoilDetail() {
  const sp = currentSoil, m = sp.market || {}, rec = sp.recipe || {}, mine = sp.owner === me, owner = memberBy(sp.owner);
  const pg = perGallon(m.est_price_range, sp.size);
  const ings = (rec.ingredients || []).map((i) => `<div class="ing"><span>${esc(i.name)}</span><b>${esc(i.parts || "")}</b></div>`).join("");
  const suits = (rec.suits || []).map((s) => `<span>${esc(s)}</span>`).join("");
  let html = `<h2 class="vh" style="margin:2px 0 2px">${esc(sp.name)}</h2>
    <div class="ssz" style="margin-bottom:12px">${esc(sp.size || "")} · by ${esc(owner.display_name)}</div>`;
  if (sp.thumbnail) html += `<img src="${sp.thumbnail}" style="width:100%;max-height:240px;object-fit:cover;border-radius:12px;border:1px solid var(--rule)" alt="">`;
  html += `<div class="rcard" style="margin-top:14px"><div class="rh"><span class="rt">Market value</span><span class="rs">${m.score ?? "–"}<small>/10</small></span></div>
    <div class="price">${esc(m.est_price_range || "—")}${pg ? ` <span style="color:var(--sepia);font-size:13px;font-weight:400">≈ ${pg}/gal</span>` : ""}</div>
    <div class="meta">${m.demand ? esc(cap(m.demand)) + " demand" : ""}</div>
    ${m.sell_notes ? `<div class="notes">${esc(m.sell_notes)}</div>` : ""}
    <div class="ssz" id="soilUpdating" style="margin-top:6px"></div></div>`;
  if (ings || suits) {
    html += `<div class="sec"><h3 class="sec-h">Recipe</h3>${ings}${suits ? `<div class="rsub">Good for</div><div class="suits">${suits}</div>` : ""}</div>`;
  }
  if (mine) {
    html += `<div class="savedrow" style="margin-top:16px">
      <div class="who">Manage</div>
      <div class="pickline" style="margin-top:2px"><label>Bag size</label><select id="soilSize">${SOIL_SIZES.map((s) => `<option ${sp.size === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
      <button class="mktbtn ${sp.in_market ? "on" : ""}" id="soilMkt">${sp.in_market ? "✓ Listed on Marketplace" : "＋ List on Marketplace"}</button>
      <div class="mline2"><button class="mgbtn ${sp.sold ? "on" : ""}" id="soilSold">${sp.sold ? "↩ Mark available" : "✓ Mark as sold"}</button></div>
      <div class="mline2"><button class="link" id="soilPhoto">${sp.thumbnail ? "Change photo" : "Add photo"}</button></div>
      <button class="delbtn" id="soilDel">Delete batch</button>
    </div>`;
  }
  $("soilBody").innerHTML = html;
  if (mine) {
    $("soilSize").onchange = (e) => soilSizeChanged(e.target.value);
    $("soilMkt").onclick = () => soilPatch({ in_market: !currentSoil.in_market });
    $("soilSold").onclick = () => soilPatch({ sold: !currentSoil.sold });
    $("soilPhoto").onclick = () => $("soilPhotoInput").click();
    $("soilDel").onclick = soilDelete;
  }
}

/* ================= SEEDS ================= */
let seeds = [];
let currentSeed = null;

async function loadSeeds() {
  if (!me) return showPicker();
  const box = $("seed-list");
  box.innerHTML = `<button class="soilnew" id="seedNew">＋ New seed variety</button><div class="empty">Loading…</div>`;
  try { seeds = await (await fetch("/seeds/mine", { headers: { "X-User": me } })).json(); } catch (e) { seeds = []; }
  drawSeeds();
}
function drawSeeds() {
  const box = $("seed-list");
  let html = `<button class="soilnew" id="seedNew">＋ New seed variety</button>`;
  html += seeds.length ? seeds.map(seedCard).join("") : emptyState("No seeds yet.<br>Tap <b>New seed variety</b> to add one.");
  box.innerHTML = html;
  $("seedNew").onclick = newSeed;
  box.querySelectorAll(".spack").forEach((el, i) => (el.onclick = () => openSeed(seeds[i])));
}
function seedCard(sd) {
  const m = sd.market || {};
  const img = sd.thumbnail ? `<img class="sph" src="${sd.thumbnail}" alt="">` : `<div class="snoph">🌰</div>`;
  const badges = `${sd.in_market ? '<span class="sb market">Listed</span>' : ""}${sd.sold ? '<span class="sb sold">Sold</span>' : ""}`;
  return `<div class="spack">${img}<div>
    <div class="snm">${esc(sd.name)}</div>
    <div class="ssz">${esc(sd.quantity || "")}${m.score ? ` · sell ${m.score}/10` : ""}</div>
    ${badges ? `<div class="sbadges">${badges}</div>` : ""}</div>
    <div class="sprice">${m.est_price_range ? `<b>${esc(m.est_price_range)}</b>` : ""}</div></div>`;
}
async function newSeed() {
  if (!me) return showPicker();
  const name = prompt("Seed variety (e.g. Tomato 'Brandywine'):");
  if (!name) return;
  const btn = $("seedNew");
  if (btn) { btn.disabled = true; btn.textContent = "Adding & pricing…"; }
  let sd = null;
  try {
    const r = await fetch("/seeds", { method: "POST", headers: { "Content-Type": "application/json", "X-User": me },
      body: JSON.stringify({ name, quantity: "1 packet", visibility: "family", in_market: false }) });
    if (r.ok) sd = await r.json();
  } catch (e) { /* handled below */ }
  if (btn) { btn.disabled = false; btn.textContent = "＋ New seed variety"; }
  if (sd) openSeed(sd); else alert("Couldn't add that — try again.");
}
function openSeed(sd) { currentSeed = sd; renderSeedDetail(); $("seedDetail").classList.add("on"); }
function closeSeed() { $("seedDetail").classList.remove("on"); loadSeeds(); }
async function seedPatch(fields, rerender = true) {
  try {
    const r = await fetch("/seeds/" + currentSeed.id, { method: "PATCH", headers: { "Content-Type": "application/json", "X-User": me }, body: JSON.stringify(fields) });
    if (r.ok) { currentSeed = await r.json(); if (rerender) renderSeedDetail(); }
  } catch (e) { /* keep UI */ }
}
async function seedDelete() {
  if (!confirm("Delete this seed variety?")) return;
  await fetch("/seeds/" + currentSeed.id, { method: "DELETE", headers: { "X-User": me } });
  closeSeed();
}
function renderSeedDetail() {
  const sd = currentSeed, m = sd.market || {}, mine = sd.owner === me, owner = memberBy(sd.owner);
  let html = `<h2 class="vh" style="margin:2px 0 2px">${esc(sd.name)}</h2>
    <div class="ssz" style="margin-bottom:12px">${esc(sd.quantity || "")}${sd.source ? ` · ${esc(sd.source)}` : ""} · by ${esc(owner.display_name)}</div>`;
  if (sd.thumbnail) html += `<img src="${sd.thumbnail}" style="width:100%;max-height:240px;object-fit:cover;border-radius:12px;border:1px solid var(--rule)" alt="">`;
  html += `<div class="rcard" style="margin-top:14px"><div class="rh"><span class="rt">Market value</span><span class="rs">${m.score ?? "–"}<small>/10</small></span></div>
    <div class="price">${esc(m.est_price_range || "—")}</div>
    <div class="meta">${m.demand ? esc(cap(m.demand)) + " demand" : ""}</div>
    ${m.sell_notes ? `<div class="notes">${esc(m.sell_notes)}</div>` : ""}</div>`;
  if (mine) {
    html += `<div class="savedrow" style="margin-top:16px">
      <div class="who">Manage</div>
      <input class="nick" id="seedQty" placeholder="Quantity (e.g. 1 packet)" value="${esc(sd.quantity)}" style="margin-top:2px" />
      <input class="nick" id="seedSrc" placeholder="Source (optional)" value="${esc(sd.source)}" style="margin-top:8px" />
      <button class="mktbtn ${sd.in_market ? "on" : ""}" id="seedMkt">${sd.in_market ? "✓ Listed on Marketplace" : "＋ List on Marketplace"}</button>
      <div class="mline2"><button class="mgbtn ${sd.sold ? "on" : ""}" id="seedSold">${sd.sold ? "↩ Mark available" : "✓ Mark as sold"}</button></div>
      <div class="mline2"><button class="link" id="seedPhoto">${sd.thumbnail ? "Change photo" : "Add photo"}</button></div>
      <button class="delbtn" id="seedDel">Delete seed</button>
    </div>`;
  }
  $("seedBody").innerHTML = html;
  if (mine) {
    $("seedQty").onblur = (e) => seedPatch({ quantity: e.target.value }, false);
    $("seedSrc").onblur = (e) => seedPatch({ source: e.target.value }, false);
    $("seedMkt").onclick = () => seedPatch({ in_market: !currentSeed.in_market });
    $("seedSold").onclick = () => seedPatch({ sold: !currentSeed.sold });
    $("seedPhoto").onclick = () => $("seedPhotoInput").click();
    $("seedDel").onclick = seedDelete;
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
document.querySelectorAll("#market-toggle button").forEach((b) => (b.onclick = () => showMarketView(b.dataset.mkt)));
$("backupBtn").onclick = () => { window.location.href = "/backup"; };
$("restoreBtn").onclick = () => $("restoreInput").click();
$("restoreInput").onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  $("restoreMsg").textContent = "Restoring…";
  try {
    const data = JSON.parse(await f.text());
    const r = await fetch("/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    const out = await r.json();
    $("restoreMsg").textContent = `Restored ${out.plants} plant(s) and ${out.soil} soil batch(es). Refresh to see them.`;
    if (activeTab === "family") loadFamily();
  } catch (err) {
    $("restoreMsg").textContent = "Couldn't read that backup file.";
  }
};
$("soilClose").onclick = closeSoil;
$("recipeClose").onclick = closeRecipeSheet;
$("soilPhotoInput").onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f || !currentSoil) return;
  await soilPatch({ thumbnail: await thumbDataURL(f) });
};
$("seedClose").onclick = closeSeed;
$("seedPhotoInput").onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f || !currentSeed) return;
  await seedPatch({ thumbnail: await thumbDataURL(f) });
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
