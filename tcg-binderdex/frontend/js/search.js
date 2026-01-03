let collectionIds = [];
let setsCache = []; // lista de SetBrief
let setById = new Map();

function resolveSetLogoUrl(setObj){
  const logo = setObj?.logo;
  if (!logo) return null;
  // docs: pode adicionar .(webp|png|jpg) para customizar
  if (typeof logo === "string") return logo + ".png";
  return null;
}

async function loadSets(){
  // usa o idioma atual
  const lang = getLang();
  const select = document.getElementById("setSelect");
  if (!select) return;

  select.innerHTML = '<option value="">Todos os sets</option>';
  document.getElementById("setLogo")?.style && (document.getElementById("setLogo").style.display = "none");

  try{
    setsCache = await apiGet(`/sets?lang=${encodeURIComponent(lang)}`);
    setById = new Map(setsCache.map(s => [s.id, s]));
    // ordena por nome
    setsCache.sort((a,b) => (a.name||"").localeCompare(b.name||""));

    for (const s of setsCache){
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name || s.id;
      select.appendChild(opt);
    }

    // restaura seleção salva (por idioma)
    const saved = localStorage.getItem("tcg_set_" + lang) || "";
    select.value = saved;
    onSetChanged(false);
  }catch(e){
    console.warn("Falha ao carregar sets:", e);
  }
}

function onSetChanged(runSearch=true){
  const lang = getLang();
  const select = document.getElementById("setSelect");
  const id = select?.value || "";
  localStorage.setItem("tcg_set_" + lang, id);

  const logoEl = document.getElementById("setLogo");
  if (!logoEl) return;

  if (!id){
    logoEl.style.display = "none";
    logoEl.removeAttribute("src");
  } else {
    const s = setById.get(id);
    const url = resolveSetLogoUrl(s);
    if (url){
      logoEl.src = url;
      logoEl.style.display = "block";
    } else {
      logoEl.style.display = "none";
      logoEl.removeAttribute("src");
    }
  }

  if (runSearch) search();
}

async function loadCollectionIds() {
  collectionIds = await apiGet("/collection/ids");
}

async function addCard(cardId, cardEl, btnEl) {
  try {
    // feedback imediato
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.textContent = "Adicionando…";
      btnEl.classList.add("loading");
    }

    await apiPost(
      `/collection/add?card_id=${encodeURIComponent(cardId)}&lang=${encodeURIComponent(getLang())}`
    );

    // atualiza estado local
    if (!collectionIds.includes(cardId)) collectionIds.push(cardId);

    // atualiza somente este card no DOM
    if (cardEl) {
      cardEl.classList.add("owned");

      const actions = cardEl.querySelector(".card-actions");
      if (actions) {
        actions.innerHTML = "";
        const tag = document.createElement("span");
        tag.className = "tag tag-green";
        tag.textContent = "Na coleção";
        actions.appendChild(tag);
      }
    }
  } catch (e) {
    // rollback visual em caso de erro
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.textContent = "Adicionar";
      btnEl.classList.remove("loading");
    }
    alert(e.message || String(e));
  }
}



function buildAssetWithExt(assetBase, ext){
  if (!assetBase) return null;
  const b = String(assetBase);
  // se já tiver extensão, retorna como está
  if (b.match(/\.(png|webp|jpg)$/i)) return b;
  // alguns assets podem vir como pasta (raro). Se terminar com '/', remove.
  const cleaned = b.endsWith("/") ? b.slice(0, -1) : b;
  return cleaned + "." + ext;
}

function resolveSetLogoFromCard(card){
  // 1) tenta direto no card (quando vier)
  const fromCard = card?.set?.logo;
  let logo = (typeof fromCard === "string") ? fromCard : null;

  // 2) tenta achar o Set no cache (carregado de /sets) via card.set.id
  let sid = (typeof card?.set?.id === "string") ? card.set.id : null;

  // 3) fallback: muitos IDs de carta são "<setId>-<nº>", ex: "swsh8-86"
  // então pegamos o prefixo antes do primeiro "-"
  if (!sid && typeof card?.id === "string" && card.id.includes("-")){
    sid = card.id.split("-")[0];
  }

  if (!logo && sid){
    const s = setById?.get(sid);
    if (typeof s?.logo === "string") logo = s.logo+".png";
  }

  if (!logo) return null;

  // Retorna a base; o caller adiciona extensão (.png/.webp/.jpg)
  return logo;
}

function renderResults(cards) {
  const results = document.getElementById("results");
  results.innerHTML = "";

  if (!Array.isArray(cards) || cards.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Nenhuma carta encontrada.";
    results.appendChild(empty);
    return;
  }

  const readonly = !!__activeBinderMeta?.readonly;

  cards.forEach(card => {
    const owned = collectionIds.includes(card.id);

    const item = document.createElement("div");
    item.className = "result-card" + (owned ? " owned" : "");
    item.addEventListener("click", () => openCardModal(card.id, getLang()));

    const imgWrap = document.createElement("div");
    imgWrap.className = "card-media";

    const imgSrc = resolveImage(card);
    if (imgSrc) {
      const img = document.createElement("img");
      img.src = imgSrc;
      img.alt = card.name || "Carta";
      img.loading = "lazy";
      imgWrap.appendChild(img);
    } else {
      const no = document.createElement("div");
      no.className = "no-image";
      no.textContent = "Sem imagem";
      imgWrap.appendChild(no);
    }

    const meta = document.createElement("div");
meta.className = "card-meta";

// Linha inferior: logo do set (esquerda) + nome (meio) + ação (direita)
const bottom = document.createElement("div");
bottom.className = "card-bottom";

const setBox = document.createElement("div");
setBox.className = "set-box";

const setLogoUrl = resolveSetLogoFromCard(card);
if (setLogoUrl){
  const sl = document.createElement("img");
  sl.className = "set-mini-logo";
  sl.src = setLogoUrl;
  sl.alt = "Logo do set";
  sl.loading = "lazy";
  setBox.appendChild(sl);
} else {
  const ph = document.createElement("div");
  ph.className = "set-mini-logo placeholder";
  ph.textContent = "•";
  setBox.appendChild(ph);
}

const setNameEl = document.createElement("div");
setNameEl.className = "set-name";
setNameEl.textContent = (card.set?.name || "") + (card.localId ? ` • #${card.localId}` : "");
setBox.appendChild(setNameEl);

const title = document.createElement("div");
title.className = "card-title";
title.textContent = card.name || "(sem nome)";

const actions = document.createElement("div");
actions.className = "card-actions";

if (owned) {
  const tag = document.createElement("span");
  tag.className = "tag tag-green";
  tag.textContent = "Na coleção";
  actions.appendChild(tag);
} else {
  const btn = document.createElement("button");
  btn.className = "btn btn-primary";
  btn.textContent = readonly ? "Somente leitura" : "Adicionar";
  btn.disabled = readonly;
  btn.addEventListener("click", (e) => {
  e.stopPropagation();
  addCard(card.id, item, btn);
});

  actions.appendChild(btn);
}

bottom.appendChild(setBox);
bottom.appendChild(actions);

meta.appendChild(title);
meta.appendChild(bottom);

item.appendChild(imgWrap);
item.appendChild(meta);
    results.appendChild(item);
  });
}

async function search() {
  const q = document.getElementById("searchInput").value.trim();
  const results = document.getElementById("results");

  const setIdSelected = document.getElementById("setSelect")?.value || "";

  if (!q && !setIdSelected) {
    results.innerHTML = "";
    return;
  }

  results.innerHTML = "<div class='loading'>Buscando…</div>";

  await loadCollectionIds();

  const lang = getLang();
const setId = document.getElementById("setSelect")?.value || "";

let cards = [];
if (setId){
  // regra solicitada: se set selecionado, lista todas as cartas do set (mesmo com nome preenchido)
  const setObj = await apiGet(`/sets/${encodeURIComponent(setId)}?lang=${encodeURIComponent(lang)}`);
  cards = Array.isArray(setObj?.cards) ? setObj.cards : [];
} else {
  cards = await apiGet(`/cards/search?name=${encodeURIComponent(q)}&lang=${encodeURIComponent(lang)}`);
}

renderResults(cards);}

function goToBinder() {
  window.location.href = "binder.html";
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadBindersIntoSelect("binderSelect");
  syncLangUi();
  await loadSets();
});
