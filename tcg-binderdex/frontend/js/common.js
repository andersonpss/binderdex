const API_BASE =
  (window.API_BASE || localStorage.getItem("API_BASE") || "http://127.0.0.1:8000").replace(/\/$/, "");


async function apiGet(path) {
  const r = await fetch(API_BASE + path);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function apiPost(path) {
  const r = await fetch(API_BASE + path, { method: "POST" });
  if (!r.ok) {
    let msg = "Falha";
    try {
      const j = await r.json();
      msg = j.detail || JSON.stringify(j);
    } catch {
      msg = await r.text();
    }
    throw new Error(msg);
  }
  return r.json();
}

function resolveImage(card) {
  if (typeof card?.image === "string") return card.image + "/low.png";
  if (card?.image?.low) return card.image.low;
  if (card?.images?.small) return card.images.small;
  if (card?.images?.large) return card.images.large;
  return null;
}

let __bindersCache = [];
let __activeBinderId = null;
let __activeBinderMeta = null;

async function loadBindersIntoSelect(selectId) {
  __bindersCache = await apiGet("/binders");
  const active = await apiGet("/binders/active");
  __activeBinderId = active.active;

  const sel = document.getElementById(selectId);
  if (!sel) return;

  sel.innerHTML = "";
  __bindersCache.forEach(b => {
    const opt = document.createElement("option");
    opt.value = b.id;

    const star = b.favorite ? "⭐ " : "";
    const lock = b.readonly ? "🔒 " : "";
    opt.textContent = `${star}${lock}${b.name} (${b.count})`;

    sel.appendChild(opt);
  });

  sel.value = __activeBinderId;
  __activeBinderMeta = __bindersCache.find(b => b.id === __activeBinderId) || null;

  updateReadonlyBadge();
  syncLangUi();
}

function getSelectedBinderId(selectId) {
  const sel = document.getElementById(selectId);
  return sel?.value || null;
}

async function selectBinderBySelect(selectId, onChanged) {
  const id = getSelectedBinderId(selectId);
  if (!id) return;

  await apiPost(`/binders/select?binder_id=${encodeURIComponent(id)}`);
  await loadBindersIntoSelect(selectId);
  if (typeof onChanged === "function") await onChanged();
}

function updateReadonlyBadge() {
  const badge = document.getElementById("readonlyBadge");
  if (!badge) return;

  const meta = __activeBinderMeta;
  if (meta?.readonly) {
    badge.textContent = "SOMENTE LEITURA";
    badge.style.display = "inline-flex";
  } else {
    badge.style.display = "none";
  }
}

async function createBinder(selectId, onChanged) {
  const name = prompt("Nome do novo binder:");
  if (!name) return;
  await apiPost(`/binders/create?name=${encodeURIComponent(name)}`);
  await loadBindersIntoSelect(selectId);
  if (typeof onChanged === "function") await onChanged();
}

async function renameBinder(selectId) {
  const id = getSelectedBinderId(selectId);
  if (!id) return;

  const current = __bindersCache.find(b => b.id === id);
  const name = prompt("Novo nome do binder:", current?.name || "");
  if (!name) return;

  await apiPost(`/binders/rename?binder_id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`);
  await loadBindersIntoSelect(selectId);
}

async function duplicateBinder(selectId, onChanged) {
  const id = getSelectedBinderId(selectId);
  if (!id) return;

  const current = __bindersCache.find(b => b.id === id);
  const name = prompt("Nome do binder duplicado (opcional):", (current?.name || "Binder") + " (cópia)");
  const url = `/binders/duplicate?binder_id=${encodeURIComponent(id)}&name=${encodeURIComponent(name || "")}`;
  await apiPost(url);
  await loadBindersIntoSelect(selectId);
  if (typeof onChanged === "function") await onChanged();
}

async function toggleReadonly(selectId) {
  const id = getSelectedBinderId(selectId);
  if (!id) return;

  const current = __bindersCache.find(b => b.id === id);
  const next = !current?.readonly;

  await apiPost(`/binders/readonly?binder_id=${encodeURIComponent(id)}&readonly=${next}`);
  await loadBindersIntoSelect(selectId);
  alert(next ? "Binder agora está em modo somente leitura." : "Binder agora está editável.");
}

async function setFavorite(selectId) {
  const id = getSelectedBinderId(selectId);
  if (!id) return;
  await apiPost(`/binders/favorite?binder_id=${encodeURIComponent(id)}`);
  await loadBindersIntoSelect(selectId);
}

async function deleteBinder(selectId, onChanged) {
  const id = getSelectedBinderId(selectId);
  if (!id) return;

  const current = __bindersCache.find(b => b.id === id);
  const ok = confirm(`Excluir o binder "${current?.name || id}"?\nEssa ação não pode ser desfeita.`);
  if (!ok) return;

  const r = await apiPost(`/binders/delete?binder_id=${encodeURIComponent(id)}`);
  if (r.status === "last_binder") {
    alert("Não é possível excluir o último binder.");
    return;
  }

  await loadBindersIntoSelect(selectId);
  if (typeof onChanged === "function") await onChanged();
}

function exportBinderJSON(selectId) {
  const id = getSelectedBinderId(selectId);
  if (!id) return;
  window.open(`${API_BASE}/binders/export/json?binder_id=${encodeURIComponent(id)}`, "_blank");
}

function exportBinderPDF(selectId) {
  const id = getSelectedBinderId(selectId);
  if (!id) return;
  window.open(`${API_BASE}/binders/export/pdf?binder_id=${encodeURIComponent(id)}`, "_blank");
}


// ---------- Modal de detalhes ----------
let __modalCache = new Map(); // `${lang}:${cardId}` -> cardDetails


function closeCardModal(){
  const m = document.getElementById("cardModal");
  if (m) m.style.display = "none";
  const body = document.getElementById("cardModalBody");
  if (body) body.innerHTML = "";
}

function _pill(text){
  const s = document.createElement("span");
  s.className = "pill";
  s.textContent = text;
  return s;
}

function _renderModalCard(card){
  const body = document.getElementById("cardModalBody");
  if (!body) return;

  const imgSrc =
    (typeof card?.image === "string" ? card.image + "/high.png" : null)
    || card?.image?.high
    || card?.image?.low
    || card?.images?.large
    || card?.images?.small
    || resolveImage(card);

  const grid = document.createElement("div");
  grid.className = "modal-grid";

  const left = document.createElement("div");
  const imgWrap = document.createElement("div");
  imgWrap.className = "modal-cardimg";
  if (imgSrc){
    const img = document.createElement("img");
    img.src = imgSrc;
    img.alt = card?.name || "Carta";
    img.loading = "lazy";
    imgWrap.appendChild(img);
  } else {
    const no = document.createElement("div");
    no.className = "no-image";
    no.textContent = "Sem imagem";
    imgWrap.appendChild(no);
  }
  left.appendChild(imgWrap);

  const right = document.createElement("div");
  const h1 = document.createElement("h2");
  h1.className = "modal-h1";
  h1.textContent = card?.name || "(sem nome)";

  const meta = document.createElement("div");
  meta.className = "modal-meta";
  const setName = card?.set?.name || card?.set || "";
  const localId = card?.localId ? `#${card.localId}` : (card?.number ? `#${card.number}` : "");
  meta.textContent = [setName, localId].filter(Boolean).join(" • ");

  const pills = document.createElement("div");
  pills.className = "pill-row";
  if (card?.rarity) pills.appendChild(_pill(card.rarity));
  if (card?.hp) pills.appendChild(_pill(`HP ${card.hp}`));
  if (Array.isArray(card?.types)) card.types.forEach(t => pills.appendChild(_pill(t)));
  if (card?.category) pills.appendChild(_pill(card.category));

  // Dados rápidos (kv)
  const kv = document.createElement("div");
  kv.className = "kv";
  const addKV = (k,v) => {
    if (v === undefined || v === null || v === "") return;
    const kk = document.createElement("div"); kk.className = "k"; kk.textContent = k;
    const vv = document.createElement("div"); vv.textContent = String(v);
    kv.appendChild(kk); kv.appendChild(vv);
  };

  addKV("ID", card?.id);
  addKV("Série", card?.serie?.name);
  addKV("Coleção", card?.set?.name);
  addKV("Nº local", card?.localId);
  addKV("Ilustrador", card?.illustrator);
  addKV("Regulation", card?.regulationMark);
  addKV("Retreat", card?.retreat);
  addKV("Stage", card?.stage);
  addKV("Suffix", card?.suffix);

  // Sections: abilities, attacks, weaknesses, resistances
  const makeSection = (title) => {
    const s = document.createElement("div");
    s.className = "section";
    const h = document.createElement("h3");
    h.textContent = title;
    s.appendChild(h);
    return s;
  };

  if (Array.isArray(card?.abilities) && card.abilities.length){
    const sec = makeSection("Habilidades");
    const list = document.createElement("div"); list.className = "list";
    card.abilities.forEach(a => {
      const it = document.createElement("div"); it.className = "item";
      const t = document.createElement("div"); t.className = "t"; t.textContent = a?.name || "Habilidade";
      const d = document.createElement("div"); d.textContent = a?.effect || a?.text || "";
      it.appendChild(t); it.appendChild(d);
      list.appendChild(it);
    });
    sec.appendChild(list);
    right.appendChild(sec);
  }

  if (Array.isArray(card?.attacks) && card.attacks.length){
    const sec = makeSection("Ataques");
    const list = document.createElement("div"); list.className = "list";
    card.attacks.forEach(a => {
      const it = document.createElement("div"); it.className = "item";
      const t = document.createElement("div"); t.className = "t";
      const cost = Array.isArray(a?.cost) ? ` (${a.cost.join(", ")})` : "";
      const dmg = a?.damage ? ` • ${a.damage}` : "";
      t.textContent = `${a?.name || "Ataque"}${cost}${dmg}`;
      const d = document.createElement("div"); d.textContent = a?.effect || a?.text || "";
      it.appendChild(t); it.appendChild(d);
      list.appendChild(it);
    });
    sec.appendChild(list);
    right.appendChild(sec);
  }

  const renderTypedList = (title, arr, keyType="type", keyVal="value") => {
    if (!Array.isArray(arr) || !arr.length) return;
    const sec = makeSection(title);
    const list = document.createElement("div"); list.className = "list";
    arr.forEach(x => {
      const it = document.createElement("div"); it.className = "item";
      const t = document.createElement("div"); t.className = "t";
      t.textContent = `${x?.[keyType] ?? ""} ${x?.[keyVal] ?? ""}`.trim();
      it.appendChild(t);
      list.appendChild(it);
    });
    sec.appendChild(list);
    right.appendChild(sec);
  };

  renderTypedList("Fraquezas", card?.weaknesses);
  renderTypedList("Resistências", card?.resistances);

  // Pricing (se existir)
  if (card?.pricing){
    const sec = makeSection("Preços");
    const kv2 = document.createElement("div"); kv2.className = "kv";
    const add = (k,v)=>{ if(v==null) return; const kk=document.createElement("div"); kk.className="k"; kk.textContent=k; const vv=document.createElement("div"); vv.textContent=String(v); kv2.appendChild(kk); kv2.appendChild(vv); };
    const cm = card.pricing?.cardmarket;
    const tp = card.pricing?.tcgplayer;
    if (cm){
      add("Cardmarket avg", cm.average ?? cm.avg);
      add("Cardmarket low", cm.low);
      add("Cardmarket trend", cm.trend);
    }
    if (tp){
      add("TCGplayer market", tp.market);
      add("TCGplayer low", tp.low);
      add("TCGplayer mid", tp.mid);
    }
    sec.appendChild(kv2);
    right.appendChild(sec);
  }

  right.prepend(kv);
  right.prepend(pills);
  right.prepend(meta);
  right.prepend(h1);

  grid.appendChild(left);
  grid.appendChild(right);

  body.innerHTML = "";
  body.appendChild(grid);
}

async function openCardModal(cardId, langOverride){
  if (!cardId) return;

  const modal = document.getElementById("cardModal");
  const body = document.getElementById("cardModalBody");
  if (!modal || !body) return;

  const lang = (langOverride || getLang() || "pt").toLowerCase();

  modal.style.display = "block";
  body.innerHTML = "<div class='loading'>Carregando detalhes…</div>";

  try{
    const key = `${lang}:${cardId}`;

    let card = __modalCache.get(key);
    if (!card){
      // pega pelo backend (proxy)
      card = await apiGet(`/cards/${encodeURIComponent(cardId)}?lang=${encodeURIComponent(lang)}`);
      __modalCache.set(key, card);
    }

    _renderModalCard(card);
  }catch(e){
    body.innerHTML = `<div class='empty-state'>Falha ao carregar detalhes.<br>${String(e.message || e)}</div>`;
  }
}


// fechar com ESC
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeCardModal();
});
// ---------- Língua (persistente) ----------
function getLang(){
  return localStorage.getItem("tcg_lang") || "pt";
}
function setLang(lang){
  localStorage.setItem("tcg_lang", (lang || "pt"));
}
function setLangFromUi(){
  const sel = document.getElementById("langSelect");
  if (!sel) return;
  setLang(sel.value);
}
function syncLangUi(){
  const sel = document.getElementById("langSelect");
  if (!sel) return;
  sel.value = getLang();
}
