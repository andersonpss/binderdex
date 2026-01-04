let cards = [];
let page = 0;
const perPage = 9;

// Layout edit mode (mobile-friendly move)
let __layoutEditMode = false;
let __layoutMoveFrom = null;
let __openOverlayIndex = null;

function effectiveLength(){
  for (let i = cards.length - 1; i >= 0; i--){
    if (cards[i] && typeof cards[i] === "object") return i + 1;
  }
  return 0;
}

async function loadCollection() {
  cards = await apiGet("/collection");
  const eff = effectiveLength();
  const maxPage = Math.max(0, Math.ceil(eff / perPage) - 1);
  if (page > maxPage) page = maxPage;
  render();
}


function closeAllOverlays(){
  const binder = document.getElementById("binder");
  if (!binder) return;
  binder.querySelectorAll(".binder-slot.is-open").forEach(el => el.classList.remove("is-open"));
  __openOverlayIndex = null;
}

function toggleOverlay(div, index){
  if (__layoutEditMode) return; // no overlay in edit mode
  const isOpen = div.classList.contains("is-open");
  closeAllOverlays();
  if (!isOpen){
    div.classList.add("is-open");
    __openOverlayIndex = index;
  }
}

function updateLayoutModeUI(){
  const binder = document.getElementById("binder");
  if (binder) binder.classList.toggle("layout-edit", __layoutEditMode);

  const btn = document.getElementById("layoutModeBtn");
  if (btn){
    btn.classList.toggle("active", __layoutEditMode);
    btn.setAttribute("aria-pressed", __layoutEditMode ? "true" : "false");
    btn.title = __layoutEditMode ? "Sair do modo edição" : "Modo edição (layout)";
  }

  const ind = document.getElementById("layoutModeIndicator");
  if (ind){
    ind.style.display = __layoutEditMode ? "inline-flex" : "none";
  }
}

function clearMoveSelection(){
  __layoutMoveFrom = null;
  const binder = document.getElementById("binder");
  if (!binder) return;
  binder.querySelectorAll(".binder-slot.is-selected").forEach(el => el.classList.remove("is-selected"));
}

function toggleLayoutMode(){
  if (__activeBinderMeta?.readonly) return;
  __layoutEditMode = !__layoutEditMode;
  clearMoveSelection();
  closeAllOverlays();
  render();
  updateLayoutModeUI();
}


function globalIndex(localIndex) {
  return page * perPage + localIndex;
}

function resolveBinderImage(card){
  // Binder: prioriza imagem em alta qualidade
  if (!card) return null;
  if (typeof card.image === "string") return card.image + "/low.png";
  return card?.images?.high || card?.images?.large || resolveImage(card);
}

function renderCard(
div, c, fromIndex) {
  // garante estrutura padrão do slot (evita duplicações e mantém classes CSS)
  div.innerHTML = "";

  // garante estrutura padrão do slot (evita duplicações e mantém classes CSS)
  div.innerHTML = "";

  const imgWrap = document.createElement("div");
  imgWrap.className = "binder-media";

      const imgSrc = resolveBinderImage(c);
  if (imgSrc) {
    const imgEl = document.createElement("img");
    imgEl.src = imgSrc;
    imgEl.alt = c.name || "Carta";
    imgEl.loading = "lazy";
    imgWrap.appendChild(imgEl);
  } else {
    const span = document.createElement("div");
    span.className = "no-image";
    span.textContent = "Sem imagem";
    imgWrap.appendChild(span);
  }

  const overlay = document.createElement("div");
  overlay.className = "binder-overlay";


  const title = document.createElement("div");
  title.className = "binder-title";
  title.textContent = c.name || "";

  const sub = document.createElement("div");
  sub.className = "binder-subtitle";
  const setName = c.set || "";
  const number = c.number ? `#${c.number}` : "";
  sub.textContent = [setName, number].filter(Boolean).join(" • ");

  const actions = document.createElement("div");
  actions.className = "binder-actions";

  const readonly = !!__activeBinderMeta?.readonly;

  const btnRemove = document.createElement("button");
  btnRemove.className = "icon-btn danger";
  btnRemove.title = "Remover";
  btnRemove.textContent = "🗑️";
  btnRemove.disabled = readonly;
  btnRemove.addEventListener("click", (e) => {
    e.stopPropagation();
    removeCard(fromIndex);
  });

  const btnMove = document.createElement("button");
  btnMove.className = "icon-btn";
  btnMove.title = "Mover para página";
  btnMove.textContent = "⇅";
  btnMove.disabled = readonly;
  btnMove.addEventListener("click", (e) => {
    e.stopPropagation();
    moveToPage(fromIndex);
  });

  actions.appendChild(btnRemove);
  actions.appendChild(btnMove);

  overlay.appendChild(title);
  overlay.appendChild(sub);
  overlay.appendChild(actions);

  div.appendChild(imgWrap);
  div.appendChild(overlay);
}

// Cache de logos de sets (binder overlay)
const __setLogoCache = new Map(); // key: `${lang}:${setId}` -> logoUrl (com extensão)

function getSetIdFromCard(card){
  if (!card) return null;
  if (typeof card.setId === "string" && card.setId) return card.setId;
  if (typeof card.id === "string" && card.id.includes("-")) return card.id.split("-")[0];
  return null;
}

function resolveSetLogoUrl(setObj){
  const logo = setObj?.logo;
  if (!logo) return null;
  if (typeof logo === "string"){
    return logo.match(/\.(png|webp|jpg)$/i) ? logo : (logo.endsWith("/") ? logo.slice(0,-1) : logo) + ".png";
  }
  return null;
}

async function ensureSetLogo(setId, lang, imgEl){
  if (!setId || !lang || !imgEl) return;
  const key = `${lang}:${setId}`;
  const cached = __setLogoCache.get(key);
  if (cached){
    imgEl.src = cached;
    imgEl.style.display = "block";
    return;
  }
  try{
    const s = await apiGet(`/sets/${encodeURIComponent(setId)}?lang=${encodeURIComponent(lang)}`);
    const url = resolveSetLogoUrl(s);
    if (url){
      __setLogoCache.set(key, url);
      imgEl.src = url;
      imgEl.style.display = "block";
    }else{
      imgEl.style.display = "none";
    }
  }catch{
    imgEl.style.display = "none";
  }
}

function goToSetSearch(setId, lang){
  if (!setId) return;
  const l = lang || getLang?.() || "pt";
  // Ajusta a língua e seleciona o set no search.html
  try{
    localStorage.setItem("tcg_lang", l);
    localStorage.setItem("tcg_set_" + l, setId);
  }catch{}
  window.location.href = "search.html";
}

function renderCard(
div, c, fromIndex) {
  // garante estrutura padrão do slot (evita duplicações e mantém classes CSS)
  div.innerHTML = "";

  const imgWrap = document.createElement("div");
  imgWrap.className = "binder-media";

    const imgSrc = resolveBinderImage(c);
  if (imgSrc) {
    const imgEl = document.createElement("img");
    imgEl.src = imgSrc;
    imgEl.alt = c.name || "Carta";
    imgEl.loading = "lazy";
    imgWrap.appendChild(imgEl);
  } else {
    const span = document.createElement("div");
    span.className = "no-image";
    span.textContent = "Sem imagem";
    imgWrap.appendChild(span);
  }

  const overlay = document.createElement("div");
  overlay.className = "binder-overlay";


  
const setRow = document.createElement("div");
setRow.className = "binder-setrow";

const setId = getSetIdFromCard(c);
const lang = c.lang || (typeof getLang === "function" ? getLang() : "pt");

const setLink = document.createElement("a");
setLink.className = "binder-setlink";
setLink.href = "search.html";
setLink.title = "Abrir coleção no buscador";
setLink.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  goToSetSearch(setId, lang);
});

const setLogo = document.createElement("img");
setLogo.className = "binder-setlogo";
setLogo.alt = "Logo do set";
setLogo.loading = "lazy";
setLogo.style.display = "none";
setLink.appendChild(setLogo);

if (setId){
  ensureSetLogo(setId, lang, setLogo);
}

const setText = document.createElement("span");
setText.className = "binder-settext";
setText.textContent = c.set || setId || "";
setLink.appendChild(setText);

setRow.appendChild(setLink);
const title = document.createElement("div");
  title.className = "binder-title";
  title.textContent = c.name || "";

  const sub = document.createElement("div");
  sub.className = "binder-subtitle";
  const setName = c.set || "";
  const number = c.number ? `#${c.number}` : "";
  sub.textContent = [setName, number].filter(Boolean).join(" • ");

  const actions = document.createElement("div");
  actions.className = "binder-actions";

  const readonly = !!__activeBinderMeta?.readonly;

  const btnRemove = document.createElement("button");
  btnRemove.className = "icon-btn danger";
  btnRemove.title = "Remover";
  btnRemove.textContent = "🗑️";
  btnRemove.disabled = readonly;
  btnRemove.addEventListener("click", (e) => {
    e.stopPropagation();
    removeCard(fromIndex);
  });

  const btnMove = document.createElement("button");
  btnMove.className = "icon-btn";
  btnMove.title = "Mover para página";
  btnMove.textContent = "⇅";
  btnMove.disabled = readonly;
  btnMove.addEventListener("click", (e) => {
    e.stopPropagation();
    moveToPage(fromIndex);
  });

  actions.appendChild(btnRemove);
  actions.appendChild(btnMove);

  overlay.appendChild(setRow);
  overlay.appendChild(title);
  overlay.appendChild(sub);
  overlay.appendChild(actions);

  div.appendChild(imgWrap);
  div.appendChild(overlay);
}


function render() {
  const binder = document.getElementById("binder");
  binder.innerHTML = "";
  binder.classList.toggle("layout-edit", __layoutEditMode);

  for (let i = 0; i < perPage; i++) {
    const g = globalIndex(i);
    const c = cards[g];

    if (!c || typeof c !== "object") {
      const div = document.createElement("div");
      div.className = "binder-slot empty";

      const label = document.createElement("div");
      label.className = "empty-label";
      label.textContent = "Vazio";
      div.appendChild(label);

      div.addEventListener("click", (e) => {
        if (!__layoutEditMode) {
          closeAllOverlays();
          return;
        }
        if (__activeBinderMeta?.readonly) return;
        if (__layoutMoveFrom === null) return;
        e.preventDefault();
        e.stopPropagation();
        const fromIdx = __layoutMoveFrom;
        clearMoveSelection();
        moveCard(fromIdx, g);
      });

      if (__layoutEditMode && !__activeBinderMeta?.readonly) {
        div.addEventListener("dragover", (e) => e.preventDefault());
        div.addEventListener("drop", (e) => {
          e.preventDefault();
          const fromIndex = Number(e.dataTransfer.getData("from"));
          const toIndex = g;
          if (Number.isNaN(fromIndex)) return;
          if (fromIndex !== toIndex) moveCard(fromIndex, toIndex);
        });
      }

      binder.appendChild(div);
      continue;
    }

    const div = document.createElement("div");
    div.className = "binder-slot";

    const isTouch = matchMedia("(hover: none) and (pointer: coarse)").matches;
    div.draggable = __layoutEditMode && !__activeBinderMeta?.readonly && !isTouch;


    renderCard(div, c, g);
    div.addEventListener("click", (e) => {
      if (__layoutEditMode) {
        e.preventDefault();
        e.stopPropagation();
        closeAllOverlays();
        // tap-to-move selection
        if (__layoutMoveFrom === null) {
          __layoutMoveFrom = g;
          div.classList.add("is-selected");
          return;
        }
        if (__layoutMoveFrom === g) {
          clearMoveSelection();
          return;
        }
        const fromIdx = __layoutMoveFrom;
        clearMoveSelection();
        moveCard(fromIdx, g);
        return;
      }
      // normal mode: toggle overlay on click/tap release
      toggleOverlay(div, g);
});

    // Double click opens details (desktop). On mobile, use ℹ️ inside the overlay.
    div.addEventListener("dblclick", (e) => {
      if (__layoutEditMode) return;
      e.preventDefault();
      e.stopPropagation();
      closeAllOverlays();
      openCardModal(c.id, c.lang);
    });

    if (__layoutEditMode && !__activeBinderMeta?.readonly) {
      div.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("from", String(g));
      });

      div.addEventListener("dragover", (e) => e.preventDefault());

      div.addEventListener("drop", (e) => {
        e.preventDefault();
        const fromIndex = Number(e.dataTransfer.getData("from"));
        const toIndex = g;
        if (Number.isNaN(fromIndex)) return;
        if (fromIndex !== toIndex) moveCard(fromIndex, toIndex);
      });
    }

    binder.appendChild(div);
  }

  const eff = effectiveLength();
  const totalPages = Math.max(1, Math.ceil(eff / perPage));
  document.getElementById("pageInfo").innerText = `Página ${page + 1} / ${totalPages}`;
}

async function moveCard(from, to) {
  try {
    const fromPage = Math.floor(Math.max(0, from) / perPage);
    const toPage = Math.floor(Math.max(0, to) / perPage);

    // Regra:
    // - mesma página: se destino ocupado -> SWAP; se destino vazio -> PLACE (mantém gap no slot original)
    // - outra página (via mover de página): usa MOVE (empurra os demais para frente na página destino)
    let endpoint = "/collection/move";
    let payload = { from_index: from, to_index: to };

    if (fromPage === toPage) {
      const target = cards[to];
      if (!target || typeof target !== "object") {
        endpoint = "/collection/place";
        payload = { from_index: from, to_index: to };
      } else {
        endpoint = "/collection/swap";
        payload = { a_index: from, b_index: to };
      }
    }

    const r = await fetch(`${API_BASE}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      let msg = "Falha ao mover";
      try { msg = (await r.json()).detail || msg; } catch {}
      throw new Error(msg);
    }

    // Mantém a página se for swap/place; se for move entre páginas, navega pra página destino
    if (fromPage !== toPage) page = toPage;

    await loadCollection();
  } catch (e) {
    alert(e.message || String(e));
  }
}

async function moveToPage(fromIndex) {
  const input = prompt("Mover para qual página?");
  if (!input) return;

  const targetPage = Number(input) - 1;
  if (Number.isNaN(targetPage) || targetPage < 0) {
    alert("Página inválida");
    return;
  }

  const toIndex = targetPage * perPage;
  await moveCard(fromIndex, toIndex);
}

async function removeCard(index) {
  const ok = confirm("Remover esta carta do binder?");
  if (!ok) return;

  try {
    const r = await fetch(`${API_BASE}/collection/remove?index=${encodeURIComponent(index)}`, { method: "POST" });
    if (!r.ok) {
      let msg = "Falha ao remover";
      try { msg = (await r.json()).detail || msg; } catch {}
      throw new Error(msg);
    }
    await loadCollection();
  } catch (e) {
    alert(e.message || String(e));
  }
}

function nextPage() {
  const eff = effectiveLength();
  if ((page + 1) * perPage < eff) {
    page++;
    render();
  }
}

function prevPage() {
  if (page > 0) {
    page--;
    render();
  }
}

function goToSearch() {
  window.location.href = "search.html";
}

function refreshReadonlyUi() {
  render();
  updateReadonlyBadge();
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadBindersIntoSelect("binderSelect");
  await loadCollection();
  updateLayoutModeUI();
});


// Close overlay when clicking outside slots (normal mode)
document.addEventListener("click", (e) => {
  const inBinder = e.target?.closest?.("#binder");
  const slot = e.target?.closest?.(".binder-slot");
  if (!inBinder) {
    closeAllOverlays();
    return;
  }
  if (!slot) closeAllOverlays();
}, true);

