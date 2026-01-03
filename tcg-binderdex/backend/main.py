from __future__ import annotations

from fastapi import FastAPI, Body, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
import requests
import json
import os
import uuid
import copy
import tempfile

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas


app = FastAPI()

# Permite abrir o frontend via file:// (origin "null") sem bloqueio
app.add_middleware(
    CORSMiddleware,
    app.add_middleware(
     allow_origins=[
        "https://binderdex.pages.dev/",
         "https://binderdex.onrender.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

TCGDEX_BASE = "https://api.tcgdex.net/v2"

ALLOWED_LANGS = {"en","fr","es","it","de","pt","nl","pl","ja","ko","zh-cn","ru"}

def tcgdex_root(lang: str) -> str:
    lang = (lang or "pt").lower().strip()
    if lang not in ALLOWED_LANGS:
        raise HTTPException(status_code=400, detail=f"Língua inválida: {lang}")
    return f"{TCGDEX_BASE}/{lang}"

DB_FILE = "collection.json"


def _ensure_binder_fields(b: dict) -> dict:
    b.setdefault("name", "Binder")
    b.setdefault("cards", [])
    b.setdefault("readonly", False)
    b.setdefault("favorite", False)
    return b


def load_db() -> dict:
    # cria DB padrão se não existir
    if not os.path.exists(DB_FILE):
        default_id = "default"
        db = {
            "binders": {
                default_id: _ensure_binder_fields(
                    {"name": "Binder Principal", "cards": [], "readonly": False, "favorite": True}
                )
            },
            "active": default_id,
        }
        save_db(db)
        return db

    with open(DB_FILE, "r", encoding="utf-8") as f:
        db = json.load(f)

    # Migração de formatos antigos:
    # 1) {"cards":[...]}
    if "binders" not in db and "cards" in db:
        cards = db.get("cards", [])
        default_id = "default"
        db = {
            "binders": {
                default_id: _ensure_binder_fields(
                    {"name": "Binder Principal", "cards": cards, "readonly": False, "favorite": True}
                )
            },
            "active": default_id,
        }

    db.setdefault("binders", {})
    db.setdefault("active", None)

    # Garante campos novos
    for k in list(db["binders"].keys()):
        db["binders"][k] = _ensure_binder_fields(db["binders"][k])

    # Se não houver binders, cria um
    if not db["binders"]:
        default_id = "default"
        db["binders"][default_id] = _ensure_binder_fields(
            {"name": "Binder Principal", "cards": [], "readonly": False, "favorite": True}
        )
        db["active"] = default_id

    # Garante active válido
    if not db["active"] or db["active"] not in db["binders"]:
        db["active"] = next(iter(db["binders"].keys()))

    # Garante exatamente 1 favorito (se houver 0, marca o active)
    favs = [k for k, v in db["binders"].items() if v.get("favorite")]
    if len(favs) == 0:
        db["binders"][db["active"]]["favorite"] = True
    elif len(favs) > 1:
        keep = favs[0]
        for k in favs[1:]:
            db["binders"][k]["favorite"] = False

    save_db(db)
    return db


def save_db(db: dict) -> None:
    with open(DB_FILE, "w", encoding="utf-8") as f:
        json.dump(db, f, indent=2, ensure_ascii=False)


def get_active_binder(db: dict) -> dict:
    return db["binders"][db["active"]]


def ensure_not_readonly(binder: dict) -> None:
    if binder.get("readonly"):
        raise HTTPException(status_code=403, detail="Binder em modo somente leitura")


# ---------- TCGdex ----------
@app.get("/cards/search")
def search_cards(name: str, lang: str = "pt"):
    try:
        r = requests.get(f"{tcgdex_root(lang)}/cards", params={"name": name}, timeout=15)
        r.raise_for_status()
        return r.json()
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Falha ao buscar no TCGdex: {e}")



@app.get("/cards/{card_id}")
def get_card(card_id: str, lang: str = "pt"):
    """Proxy para obter detalhes completos de uma carta no TCGdex (mesma língua do backend)."""
    try:
        r = requests.get(f"{tcgdex_root(lang)}/cards/{card_id}", timeout=15)
        r.raise_for_status()
        return r.json()
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Falha ao obter card {card_id}: {e}")


# ---------- SETS ----------
@app.get("/sets")
def list_sets(lang: str = "pt"):
    """Lista de sets (SetBrief) para popular o seletor."""
    try:
        r = requests.get(f"{tcgdex_root(lang)}/sets", timeout=20)
        r.raise_for_status()
        return r.json()
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Falha ao listar sets: {e}")


@app.get("/sets/{set_id}")
def get_set(set_id: str, lang: str = "pt"):
    """Retorna um Set (inclui cards[]) conforme documentação do TCGdex."""
    try:
        r = requests.get(f"{tcgdex_root(lang)}/sets/{set_id}", timeout=25)
        r.raise_for_status()
        return r.json()
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Falha ao obter set {set_id}: {e}")


# ---------- COLLECTION (binder ativo) ----------
@app.get("/collection")
def get_collection():
    db = load_db()
    return get_active_binder(db)["cards"]


@app.get("/collection/ids")
def get_collection_ids():
    db = load_db()
    cards = get_active_binder(db)["cards"]
    return [c.get("id") for c in cards if isinstance(c, dict) and c.get("id")]

@app.post("/collection/add")
def add_card(card_id: str, lang: str = "pt"):
    db = load_db()
    binder = get_active_binder(db)
    ensure_not_readonly(binder)

    cards = binder.get("cards", [])

    # evita duplicar (considera apenas slots preenchidos)
    if card_id in [c.get("id") for c in cards if isinstance(c, dict)]:
        return {"status": "already_added"}

    try:
        r = requests.get(f"{tcgdex_root(lang)}/cards/{card_id}", timeout=15)
        r.raise_for_status()
        card = r.json()
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Erro ao buscar carta: {e}")

    set_obj = card.get("set") if isinstance(card, dict) else None
    if not isinstance(set_obj, dict):
        set_obj = {}

    entry = {
        "id": card.get("id") or card_id,
        "name": card.get("name"),
        "image": card.get("image"),
        "images": card.get("images"),
        "set": set_obj.get("name") or "",
        "setId": set_obj.get("id") or (card_id.split("-")[0] if "-" in card_id else ""),
        "number": card.get("localId"),
        "lang": lang,
    }

    # permite espaços vazios (slots None). Adiciona no primeiro slot vazio.
    placed = False
    for i in range(len(cards)):
        if not isinstance(cards[i], dict):
            cards[i] = entry
            placed = True
            break
    if not placed:
        cards.append(entry)

    binder["cards"] = cards
    save_db(db)
    return {"status": "added"}


@app.post("/collection/move")
def move_card(from_index: int = Body(...), to_index: int = Body(...)):
    """
    Move uma carta de um slot (from_index) para outro (to_index) PRESERVANDO o slot de origem como vazio (None)
    e EMPURRANDO as cartas a partir do destino para frente, até encontrar um slot vazio.

    Isso permite espaços vagos entre cartas (gaps) e evita o bug de cair "um slot antes".
    """
    db = load_db()
    binder = get_active_binder(db)
    ensure_not_readonly(binder)

    cards = binder.get("cards", [])
    if from_index < 0 or from_index >= len(cards):
        return {"status": "invalid_from"}

    if not isinstance(cards[from_index], dict):
        # não move slot vazio
        return {"status": "invalid_from"}

    if to_index < 0:
        to_index = 0

    # garante que o índice de destino exista (mantém posição absoluta por página)
    if to_index >= len(cards):
        cards.extend([None] * (to_index - len(cards) + 1))

    if from_index == to_index:
        binder["cards"] = cards
        save_db(db)
        return {"status": "ok"}

    # remove do slot de origem, deixando um gap
    carry = cards[from_index]
    cards[from_index] = None

    # insere no destino empurrando para frente; NÃO reutiliza o slot de origem como "vazio"
    pos = to_index
    while True:
        if pos == from_index:
            pos += 1
            continue

        if pos >= len(cards):
            cards.append(None)

        if cards[pos] is None:
            cards[pos] = carry
            break

        # troca e continua empurrando
        carry, cards[pos] = cards[pos], carry
        pos += 1

    binder["cards"] = cards
    save_db(db)
    return {"status": "ok"}


@app.post("/collection/remove")
def remove_card(index: int):
    db = load_db()
    binder = get_active_binder(db)
    ensure_not_readonly(binder)

    cards = binder.get("cards", [])
    if index < 0 or index >= len(cards):
        return {"status": "invalid_index"}

    # remove sem reorganizar automaticamente (vira slot vazio)
    cards[index] = None

    binder["cards"] = cards
    save_db(db)
    return {"status": "removed"}



# ---------- BINDERS ----------
# ---------- COLLECTION (operações sem empurrar) ----------
@app.post("/collection/swap")
def swap_cards(a_index: int = Body(..., embed=True), b_index: int = Body(..., embed=True)):
    """Troca duas posições sem alterar o restante (ideal para drag&drop na mesma página)."""
    db = load_db()
    binder = get_active_binder(db)
    ensure_not_readonly(binder)

    cards = binder.get("cards", [])
    if a_index < 0 or b_index < 0:
        raise HTTPException(status_code=400, detail="Índices inválidos")

    max_i = max(a_index, b_index)
    if max_i >= len(cards):
        cards.extend([None] * (max_i - len(cards) + 1))

    cards[a_index], cards[b_index] = cards[b_index], cards[a_index]
    binder["cards"] = cards
    save_db(db)
    return {"status": "ok"}


@app.post("/collection/place")
def place_card(from_index: int = Body(..., embed=True), to_index: int = Body(..., embed=True)):
    """Move para slot vazio sem empurrar: destino recebe a carta e a origem vira None."""
    db = load_db()
    binder = get_active_binder(db)
    ensure_not_readonly(binder)

    cards = binder.get("cards", [])
    if from_index < 0 or to_index < 0:
        raise HTTPException(status_code=400, detail="Índices inválidos")

    max_i = max(from_index, to_index)
    if max_i >= len(cards):
        cards.extend([None] * (max_i - len(cards) + 1))

    card = cards[from_index]
    if not isinstance(card, dict):
        raise HTTPException(status_code=400, detail="Slot de origem vazio")

    if isinstance(cards[to_index], dict):
        raise HTTPException(status_code=400, detail="Slot de destino não está vazio")

    cards[to_index] = card
    cards[from_index] = None
    binder["cards"] = cards
    save_db(db)
    return {"status": "ok"}


@app.get("/binders")
def list_binders():
    db = load_db()
    return [
        {
            "id": k,
            "name": v["name"],
            "readonly": bool(v.get("readonly", False)),
            "favorite": bool(v.get("favorite", False)),
            "count": len(v.get("cards", [])),
        }
        for k, v in db["binders"].items()
    ]


@app.get("/binders/active")
def get_active():
    db = load_db()
    return {"active": db["active"]}

@app.get("/binders/snapshot")
def binder_snapshot(binder_id: str, limit: int = 9):
    """Metadados + preview (primeiras cartas) para a página Coleção."""
    db = load_db()
    if binder_id not in db["binders"]:
        raise HTTPException(status_code=404, detail="Binder não encontrado")
    b = db["binders"][binder_id]
    cards = b.get("cards", []) or []
    lim = max(0, min(int(limit), 27))

    preview = []
    for c in cards:
        if not isinstance(c, dict):
            continue
        preview.append({
            "id": c.get("id"),
            "name": c.get("name"),
            "image": c.get("image"),
            "images": c.get("images"),
            "set": c.get("set"),
            "number": c.get("number"),
            "lang": c.get("lang", "pt"),
        })
        if len(preview) >= lim:
            break

    return {
        "id": binder_id,
        "name": b.get("name", binder_id),
        "readonly": bool(b.get("readonly", False)),
        "favorite": bool(b.get("favorite", False)),
        "count": len(cards),
        "preview": preview,
    }



@app.post("/binders/create")
def create_binder(name: str):
    db = load_db()
    binder_id = uuid.uuid4().hex[:8]
    db["binders"][binder_id] = _ensure_binder_fields(
        {"name": name, "cards": [], "readonly": False, "favorite": False}
    )
    db["active"] = binder_id
    save_db(db)
    return {"id": binder_id}


@app.post("/binders/select")
def select_binder(binder_id: str):
    db = load_db()
    if binder_id not in db["binders"]:
        return {"status": "invalid"}

    db["active"] = binder_id
    save_db(db)
    return {"status": "ok"}


@app.post("/binders/delete")
def delete_binder(binder_id: str):
    db = load_db()

    if binder_id not in db["binders"]:
        return {"status": "not_found"}

    if len(db["binders"]) == 1:
        return {"status": "last_binder"}

    del db["binders"][binder_id]

    if db["active"] == binder_id:
        db["active"] = next(iter(db["binders"].keys()))

    # se o favorito foi excluído, garante 1 favorito
    if not any(v.get("favorite") for v in db["binders"].values()):
        db["binders"][db["active"]]["favorite"] = True

    save_db(db)
    return {"status": "deleted"}


@app.post("/binders/rename")
def rename_binder(binder_id: str, name: str):
    db = load_db()
    if binder_id not in db["binders"]:
        return {"status": "invalid"}

    db["binders"][binder_id]["name"] = name
    save_db(db)
    return {"status": "ok"}


@app.post("/binders/duplicate")
def duplicate_binder(binder_id: str, name: str | None = None):
    db = load_db()
    if binder_id not in db["binders"]:
        return {"status": "invalid"}

    original = db["binders"][binder_id]
    new_id = uuid.uuid4().hex[:8]
    new_name = name or (original.get("name", "Binder") + " (cópia)")

    db["binders"][new_id] = _ensure_binder_fields(
        {
            "name": new_name,
            "cards": copy.deepcopy(original.get("cards", [])),
            "readonly": False,  # cópia nasce editável
            "favorite": False,
        }
    )

    db["active"] = new_id
    save_db(db)
    return {"status": "ok", "id": new_id}


@app.post("/binders/readonly")
def set_readonly(binder_id: str, readonly: bool):
    db = load_db()
    if binder_id not in db["binders"]:
        return {"status": "invalid"}

    db["binders"][binder_id]["readonly"] = bool(readonly)
    save_db(db)
    return {"status": "ok"}


@app.post("/binders/favorite")
def set_favorite(binder_id: str):
    db = load_db()
    if binder_id not in db["binders"]:
        return {"status": "invalid"}

    for k in db["binders"].keys():
        db["binders"][k]["favorite"] = (k == binder_id)

    save_db(db)
    return {"status": "ok"}


@app.get("/binders/export/json")
def export_binder_json(binder_id: str):
    db = load_db()
    if binder_id not in db["binders"]:
        raise HTTPException(404, "Binder não encontrado")

    payload = {"id": binder_id, **db["binders"][binder_id]}
    return JSONResponse(content=payload)


@app.get("/binders/export/pdf")
def export_binder_pdf(binder_id: str):
    db = load_db()
    if binder_id not in db["binders"]:
        raise HTTPException(404, "Binder não encontrado")

    b = db["binders"][binder_id]
    cards = b.get("cards", [])

    fd, pdf_path = tempfile.mkstemp(suffix=".pdf")
    os.close(fd)

    c = canvas.Canvas(pdf_path, pagesize=A4)
    width, height = A4

    def header(page_no: int):
        y = height - 50
        c.setFont("Helvetica-Bold", 16)
        c.drawString(40, y, f"{b.get('name','Binder')}")
        c.setFont("Helvetica", 10)
        c.drawRightString(width - 40, y, f"Página {page_no}")
        y -= 18
        c.setFont("Helvetica", 10)
        meta = f"Cartas: {len(cards)}  |  Somente leitura: {bool(b.get('readonly'))}  |  Favorito: {bool(b.get('favorite'))}"
        c.drawString(40, y, meta)
        return y - 20

    y = header(1)
    page_no = 1
    c.setFont("Helvetica", 10)

    for idx, card in enumerate(cards, start=1):
        line = f"{idx:04d}  {card.get('name','')}  |  {card.get('set','')}  |  #{card.get('number','')}"
        c.drawString(40, y, line)
        y -= 14
        if y < 60:
            c.showPage()
            page_no += 1
            y = header(page_no)
            c.setFont("Helvetica", 10)

    c.save()
    filename = f"binder_{binder_id}.pdf"
    return FileResponse(pdf_path, media_type="application/pdf", filename=filename)
