const $ = (id) => document.getElementById(id);
const pick = $("pick"), status = $("status"), card = $("card");

pick.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  card.style.display = "none";
  status.className = "status";
  status.textContent = "Reading photo…";
  const blob = await compress(file);
  $("thumb").src = URL.createObjectURL(blob);
  $("thumb").style.display = "block";
  status.textContent = "Identifying & assessing…";
  try {
    const fd = new FormData();
    fd.append("file", blob, "plant.jpg");
    const r = await fetch("/propagate", { method: "POST", body: fd });
    if (!r.ok) throw new Error((await r.json()).detail || r.statusText);
    render(await r.json());
    status.textContent = "";
  } catch (err) {
    status.className = "status err";
    status.textContent = "Couldn't analyze that — try a clearer, closer shot.";
  }
});

// downscale to max 1024px, JPEG ~0.8 to cut upload size
async function compress(file) {
  const img = await createImageBitmap(file);
  const max = 1024, s = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * s);
  c.height = Math.round(img.height * s);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, "image/jpeg", 0.8));
}

function links(species) {
  const q = encodeURIComponent(species + " propagation");
  return [
    ["Google", `https://www.google.com/search?q=${q}`],
    ["YouTube", `https://www.youtube.com/results?search_query=${q}`],
    ["r/plantclinic", `https://www.reddit.com/r/plantclinic/search/?q=${encodeURIComponent(species)}&restrict_sr=1`],
  ];
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const DX_TITLE = { healthy: "Looks healthy", watch: "Worth watching", issue: "Needs attention" };

function renderCare(c) {
  $("soil").innerHTML =
    `<div class="soilopt"><b>Buy it · all-in-one</b><span>${esc(c.soil_store_bought)}</span></div>` +
    `<div class="soilopt"><b>Mix it · DIY</b><span>${esc(c.soil_diy)}</span></div>`;
  const rows = [
    ["Sunlight", c.sunlight],
    ["Watering", c.watering],
    ["Humidity", c.humidity],
    ["Temp", c.temperature],
    ["Feeding", c.feeding],
  ];
  $("care").innerHTML = rows
    .filter(([, v]) => v)
    .map(([k, v]) => `<div class="c"><b>${k}</b><span>${esc(v)}</span></div>`)
    .join("");
}

function renderDiagnosis(dx) {
  const status = ["healthy", "watch", "issue"].includes(dx.status) ? dx.status : "watch";
  const issues = (dx.issues || [])
    .map((i) => {
      const sev = ["low", "medium", "high"].includes(i.severity) ? i.severity : "medium";
      const remedy = i.home_remedy
        ? `<div class="lab">Home remedy</div><p>${esc(i.home_remedy)}</p>` : "";
      const link = i.learn_query
        ? `<a href="https://www.google.com/search?q=${encodeURIComponent(i.learn_query)}" target="_blank" rel="noopener">How to fix this →</a>` : "";
      return (
        `<div class="issue"><div class="issue-h"><b>${esc(i.condition)}</b>` +
        `<span class="sev ${sev}">${sev}</span></div>` +
        (i.signs ? `<div class="lab">What I'm seeing</div><p>${esc(i.signs)}</p>` : "") +
        `<div class="lab">Do this</div><p>${esc(i.action)}</p>` +
        remedy + link + `</div>`
      );
    })
    .join("");
  $("dx").className = `dx ${status}`;
  $("dx").innerHTML =
    `<div class="dx-top"><span class="dot"></span>${DX_TITLE[status]}</div>` +
    `<div class="dx-sum">${esc(dx.summary)}</div>` + issues;
}

function render(d) {
  $("name").textContent = d.common_name;
  $("latin").textContent =
    d.confidence ? `${d.species} · ${Math.round(d.confidence * 100)}% match` : d.species;
  $("score").textContent = d.marketability.score;
  renderDiagnosis(d.diagnosis);
  renderCare(d.care);
  $("tags").innerHTML = [d.method, d.difficulty, d.timeline]
    .map((t) => `<span class="tag">${esc(t)}</span>`).join("");
  $("svg").innerHTML = d.diagram_svg;
  $("steps").innerHTML = d.steps.map((s) => `<li>${esc(s)}</li>`).join("");
  const m = d.marketability;
  $("selltop").innerHTML =
    `<span class="price">${m.est_price_range}</span> · ${m.demand} demand · ${m.rarity}`;
  $("sellnotes").textContent = m.sell_notes;
  $("links").innerHTML = links(d.species)
    .map(([l, u]) => `<a href="${u}" target="_blank" rel="noopener">${l}</a>`).join("");
  card.style.display = "block";
}

if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("/sw.js").catch(() => {});
