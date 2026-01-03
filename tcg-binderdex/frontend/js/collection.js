// Coleção - Carrossel 3D com abertura estilo "book cover"
// Regras:
// 1) carregar binders e snapshots (primeira página 3x3)
// 2) renderizar carrossel (DOM persistente)
// 3) clique no binder em foco -> executar animação de abrir e mostrar miniatura
// 4) segundo clique (já aberto) -> entra no binder.html (seleciona no backend)

let BINDERS = [];
let SNAP = new Map();        // binderId -> {preview: []}
let ITEMS = [];              // [{id, el, index, front}]
let idx = 0;                 // binder em foco
let opened = false;          // se o binder em foco está aberto

let drag = null;

function $(sel){ return document.querySelector(sel); }

function selectedBinder(){
  return BINDERS[idx] || null;
}

function previewImg(card){
  // Usa resolveImage do common.js (low) para carrossel (leve)
  if (!card) return null;
  try{
    const x = resolveImage(card);
    if (x) return x;
  }catch{}
  if (typeof card?.image === "string") return card.image + "/low.png";
  return card?.image?.low || card?.images?.small || card?.images?.large || null;
}

function buildPreviewGrid(preview){
  const grid = document.createElement("div");
  grid.className = "collection-preview-grid";
  for (let i=0;i<9;i++){
    const slot = document.createElement("div");
    slot.className = "collection-preview-slot";
    const c = preview?.[i];
    const src = previewImg(c);
    if (src){
      const img = document.createElement("img");
      img.src = src;
      img.loading = "eager";
      img.decoding = "async";
      img.fetchPriority = "high";
      img.alt = c?.name || "Carta";
      slot.appendChild(img);
    }else{
      const ph = document.createElement("div");
      ph.className = "collection-preview-ph";
      slot.appendChild(ph);
    }
    grid.appendChild(slot);
  }
  return grid;
}

function renderMeta(){
  const el = $("#carouselMeta");
  if (!el) return;
  const b = selectedBinder();
  if (!b){
    el.innerHTML = "<div class='empty-state'>Nenhum binder.</div>";
    return;
  }
  const star = b.favorite ? "⭐ " : "";
  const lock = b.readonly ? "🔒 " : "";
  el.innerHTML = `
    <div class="collection-meta-title">${star}${lock}${b.name}</div>
    <div class="collection-meta-sub">${b.count} cartas • ${opened ? "clique novamente para entrar" : "clique para abrir a miniatura"}</div>
  `;
}

function setOpened(state){
  opened = !!state;

  // Remove de todas as capas
  ITEMS.forEach(x => {
    x.front?.classList.remove("opened");
  });

  if (!opened) {
    renderMeta();
    return;
  }

  const it = ITEMS[idx];
  if (!it?.front) return;

  // Aplica SOMENTE na capa do binder ativo
  it.front.classList.add("opened");

  renderMeta();
}


function updateTransforms(){
  const n = ITEMS.length;
  if (!n) return;
  const radius = 280; // compacto
  const step = 360 / n;

  ITEMS.forEach((it, i) => {
    const angle = (i - idx) * step;
    it.el.style.transform = `rotateY(${angle}deg) translateZ(${radius}px)`;
    it.el.classList.toggle("active", i === idx);
  });

  // se trocou seleção, sempre fecha
 renderMeta();

}

function mountCarousel(){
  const root = $("#carousel");
  if (!root) return;

  root.innerHTML = "";
  ITEMS = [];

  if (!Array.isArray(BINDERS) || BINDERS.length === 0){
    root.innerHTML = "<div class='empty-state'>Crie seu primeiro binder no botão ➕.</div>";
    renderMeta();
    return;
  }

  BINDERS.forEach((b, i) => {
    const snap = SNAP.get(b.id) || { preview: [] };

    const item = document.createElement("div");
    item.className = "carousel-item";

    const binder = document.createElement("div");
    binder.className = "collection-binder";

    const spine = document.createElement("div");
    spine.className = "collection-spine";
    spine.textContent = "BINDER";

    const cover = document.createElement("div");
    cover.className = "collection-front";

    const badges = document.createElement("div");
    badges.className = "collection-badges";
    if (b.favorite){
      const x = document.createElement("span"); x.className="badge"; x.textContent="⭐ Favorito";
      badges.appendChild(x);
    }
    if (b.readonly){
      const x = document.createElement("span"); x.className="badge badge-lock"; x.textContent="🔒 Somente leitura";
      badges.appendChild(x);
    }

    const title = document.createElement("div");
    title.className = "collection-title";
    title.textContent = b.name;

    const sub = document.createElement("div");
    sub.className = "collection-sub";
    sub.textContent = `${b.count} cartas`;

    const hint = document.createElement("div");
    hint.className = "collection-hint";
    hint.textContent = "Clique para abrir";

    cover.appendChild(badges);
    cover.appendChild(title);
    cover.appendChild(sub);
    cover.appendChild(hint);

    const page = document.createElement("div");
    page.className = "collection-open";
    page.appendChild(buildPreviewGrid(snap.preview || []));

    binder.appendChild(spine);
    binder.appendChild(cover);
    binder.appendChild(page);
    item.appendChild(binder);

    // Clique: se não está em foco -> seleciona. Se está em foco -> abre/entra.
    item.addEventListener("click", async (e) => {
    e.stopPropagation();

    if (idx === i && opened) {
      await apiPost(`/binders/select?binder_id=${encodeURIComponent(b.id)}`);
      window.location.href = "binder.html";
      return;
    }

   // fecha visualmente o atual (remove classes)
   setOpened(false);

   // seleciona o novo
   idx = i;
   updateTransforms();

   // abre no próximo frame (permite transição)
   requestAnimationFrame(() => setOpened(true));
});



    root.appendChild(item);
    ITEMS.push({ id: b.id, el: item, index: i, front: cover });
  });

  updateTransforms();
}

function carouselNext(){
  if (!BINDERS.length) return;
  idx = (idx + 1) % BINDERS.length;
  setOpened(false);
  updateTransforms();
}

function carouselPrev(){
  if (!BINDERS.length) return;
  idx = (idx - 1 + BINDERS.length) % BINDERS.length;
  setOpened(false);
  updateTransforms();
}


async function loadData(){
  BINDERS = await apiGet("/binders");
  const active = await apiGet("/binders/active");

  SNAP = new Map();
  await Promise.all(BINDERS.map(async (b) => {
    try{
      const s = await apiGet(`/binders/snapshot?binder_id=${encodeURIComponent(b.id)}&limit=9`);
      SNAP.set(b.id, s);
    }catch{
      SNAP.set(b.id, { preview: [] });
    }
  }));

  const fav = BINDERS.findIndex(b => b.favorite);
  const act = BINDERS.findIndex(b => b.id === active.active);
  idx = fav >= 0 ? fav : (act >= 0 ? act : 0);
  opened = false;

  mountCarousel();
}

function wire(){
  const v = document.querySelector(".carousel-viewport");
  if (!v) return;

  v.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (e.deltaY > 0 || e.deltaX > 0) carouselNext();
    else carouselPrev();
  }, { passive: false });

  v.addEventListener("pointerdown", (e) => {
  // Se o clique foi em um binder, não inicia drag e não captura ponteiro
  if (e.target.closest(".carousel-item")) return;

  v.setPointerCapture?.(e.pointerId);
  drag = { x: e.clientX };
  });

  v.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (dx > 60){
      drag.x = e.clientX;
      carouselPrev();
    } else if (dx < -60){
      drag.x = e.clientX;
      carouselNext();
    }
  });
  v.addEventListener("pointerup", () => drag = null);
  v.addEventListener("pointercancel", () => drag = null);

  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") carouselPrev();
    if (e.key === "ArrowRight") carouselNext();
  });
}

// Toolbar actions (mantém nomes usados no HTML)
async function createBinderFromCollection(){
  const name = prompt("Nome do novo binder:");
  if (!name) return;
  await apiPost(`/binders/create?name=${encodeURIComponent(name)}`);
  await loadData();
}
async function renameBinderFromCollection(){
  const b = selectedBinder(); if (!b) return;
  const name = prompt("Novo nome do binder:", b.name || "");
  if (!name) return;
  await apiPost(`/binders/rename?binder_id=${encodeURIComponent(b.id)}&name=${encodeURIComponent(name)}`);
  await loadData();
}
async function duplicateBinderFromCollection(){
  const b = selectedBinder(); if (!b) return;
  const name = prompt("Nome do binder duplicado (opcional):", (b.name || "Binder") + " (cópia)");
  await apiPost(`/binders/duplicate?binder_id=${encodeURIComponent(b.id)}&name=${encodeURIComponent(name || "")}`);
  await loadData();
}
async function toggleReadonlyFromCollection(){
  const b = selectedBinder(); if (!b) return;
  await apiPost(`/binders/readonly?binder_id=${encodeURIComponent(b.id)}&readonly=${!b.readonly}`);
  await loadData();
}
async function favoriteFromCollection(){
  const b = selectedBinder(); if (!b) return;
  await apiPost(`/binders/favorite?binder_id=${encodeURIComponent(b.id)}`);
  await loadData();
}
async function deleteBinderFromCollection(){
  const b = selectedBinder(); if (!b) return;
  const ok = confirm(`Excluir o binder "${b.name}"?\nEssa ação não pode ser desfeita.`);
  if (!ok) return;
  const r = await apiPost(`/binders/delete?binder_id=${encodeURIComponent(b.id)}`);
  if (r.status === "last_binder"){
    alert("Não é possível excluir o último binder.");
    return;
  }
  await loadData();
}

document.addEventListener("DOMContentLoaded", async () => {
  wire();
  await loadData();
});

document.addEventListener("click", (e) => {
  if (!opened) return;

  // Se clicou dentro do binder ativo, não fecha
  const activeItem = document.querySelector(".carousel-item.active");
  if (activeItem && activeItem.contains(e.target)) return;

  // Clique fora → fecha
  setOpened(false);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && opened) {
    setOpened(false);
  }
});
