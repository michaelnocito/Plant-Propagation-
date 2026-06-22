import base64
import io
import json
import re
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from .claude import enrich
from .db import MEMBERS, Photo, Plant, Session, get_user, init_db
from .models import (
    CATEGORIES,
    VISIBILITIES,
    PhotoIn,
    PhotoOut,
    PhotoPatch,
    PlantIn,
    PlantOut,
    PlantPatch,
)
from .plantid import IDError, identify

_MIME = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif"}


def _decode_data_uri(uri: str) -> tuple[bytes, str]:
    """data URI (or raw base64) -> (bytes, ext)."""
    uri = uri or ""
    ext = "jpg"
    b64 = uri
    if uri.startswith("data:") and "," in uri:
        header, b64 = uri.split(",", 1)
        for e in ("png", "webp", "gif"):
            if e in header:
                ext = e
    try:
        return base64.b64decode(b64), ext
    except Exception:  # noqa: BLE001
        return b"", ext


def _safe(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "-", (name or "plant")).strip("-")[:48] or "plant"


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="Rootwork", lifespan=lifespan)
STATIC = Path(__file__).parent / "static"


@app.post("/propagate")
async def propagate(file: UploadFile):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Send an image.")
    data = await file.read()
    try:
        species, common, score = await identify(data, file.content_type)
    except IDError as e:
        raise HTTPException(422, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"ID failed: {e}") from e
    try:
        result = await enrich(species, common, data, file.content_type)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Enrich failed: {e}") from e
    result.confidence = round(score, 2)
    return result


# ---- household + saved plants ----


def _out(p: Plant) -> PlantOut:
    return PlantOut(
        id=p.id,
        owner=p.owner.slug,
        owner_name=p.owner.display_name,
        owner_color=p.owner.color,
        visibility=p.visibility,
        category=p.category,
        nickname=p.nickname,
        species=p.species,
        common_name=p.common_name,
        ai_result=json.loads(p.ai_result),
        thumbnail=p.thumbnail,
        in_market=p.in_market,
        sold=p.sold,
        props_in_progress=p.props_in_progress,
        created_at=p.created_at.isoformat(),
    )


async def _require_user(s, slug: str | None):
    user = await get_user(s, (slug or "").strip().lower()) if slug else None
    if not user:
        raise HTTPException(401, "Pick who you are first.")
    return user


@app.get("/members")
async def members():
    return MEMBERS


@app.post("/plants", response_model=PlantOut)
async def save_plant(body: PlantIn, x_user: str | None = Header(default=None)):
    if body.visibility not in VISIBILITIES:
        raise HTTPException(400, "Bad visibility.")
    if body.category not in CATEGORIES:
        raise HTTPException(400, "Bad category.")
    async with Session() as s:
        user = await _require_user(s, x_user)
        p = Plant(
            owner_id=user.id,
            visibility=body.visibility,
            category=body.category,
            nickname=body.nickname.strip()[:80],
            species=body.species or body.ai_result.get("species", ""),
            common_name=body.common_name or body.ai_result.get("common_name", ""),
            ai_result=json.dumps(body.ai_result),
            thumbnail=body.thumbnail,
            in_market=body.in_market,
        )
        s.add(p)
        await s.commit()
        await s.refresh(p, ["owner"])
        return _out(p)


@app.get("/plants/mine", response_model=list[PlantOut])
async def my_plants(x_user: str | None = Header(default=None)):
    async with Session() as s:
        user = await _require_user(s, x_user)
        rows = (
            await s.execute(
                select(Plant)
                .options(selectinload(Plant.owner))
                .where(Plant.owner_id == user.id)
                .order_by(Plant.created_at.desc())
            )
        ).scalars().all()
        return [_out(p) for p in rows]


@app.get("/plants/family", response_model=list[PlantOut])
async def family_plants():
    async with Session() as s:
        rows = (
            await s.execute(
                select(Plant)
                .options(selectinload(Plant.owner))
                .where(Plant.visibility == "family")
                .order_by(Plant.created_at.desc())
            )
        ).scalars().all()
        return [_out(p) for p in rows]


@app.patch("/plants/{plant_id}", response_model=PlantOut)
async def update_plant(plant_id: int, body: PlantPatch, x_user: str | None = Header(default=None)):
    async with Session() as s:
        user = await _require_user(s, x_user)
        p = await s.get(Plant, plant_id)
        if not p or p.owner_id != user.id:
            raise HTTPException(404, "Not found.")
        if body.visibility is not None:
            if body.visibility not in VISIBILITIES:
                raise HTTPException(400, "Bad visibility.")
            p.visibility = body.visibility
        if body.category is not None:
            if body.category not in CATEGORIES:
                raise HTTPException(400, "Bad category.")
            p.category = body.category
        if body.nickname is not None:
            p.nickname = body.nickname.strip()[:80]
        if body.in_market is not None:
            p.in_market = body.in_market
        if body.sold is not None:
            p.sold = body.sold
        if body.props_in_progress is not None:
            p.props_in_progress = max(0, min(999, body.props_in_progress))
        if body.thumbnail is not None:
            p.thumbnail = body.thumbnail
        await s.commit()
        await s.refresh(p, ["owner"])
        return _out(p)


@app.get("/plants/market", response_model=list[PlantOut])
async def market_plants():
    """Every plant either owner has listed on the marketplace."""
    async with Session() as s:
        rows = (
            await s.execute(
                select(Plant)
                .options(selectinload(Plant.owner))
                .where(Plant.in_market.is_(True))
                .order_by(Plant.created_at.desc())
            )
        ).scalars().all()
        return [_out(p) for p in rows]


@app.delete("/plants/{plant_id}")
async def delete_plant(plant_id: int, x_user: str | None = Header(default=None)):
    async with Session() as s:
        user = await _require_user(s, x_user)
        p = await s.get(Plant, plant_id)
        if not p or p.owner_id != user.id:
            raise HTTPException(404, "Not found.")
        await s.delete(p)
        await s.commit()
        return {"ok": True}


# ---- photos ----


def _photo_out(ph: Photo) -> PhotoOut:
    return PhotoOut(
        id=ph.id,
        plant_id=ph.plant_id,
        thumb=ph.thumb or ph.data,
        caption=ph.caption,
        is_cover=ph.is_cover,
        uploaded_by=ph.uploaded_by,
        created_at=ph.created_at.isoformat(),
    )


async def _owned_plant(s, plant_id: int, x_user: str | None):
    user = await _require_user(s, x_user)
    p = await s.get(Plant, plant_id)
    if not p or p.owner_id != user.id:
        raise HTTPException(404, "Not found.")
    return user, p


@app.get("/plants/{plant_id}/photos", response_model=list[PhotoOut])
async def list_photos(plant_id: int):
    async with Session() as s:
        rows = (
            await s.execute(
                select(Photo).where(Photo.plant_id == plant_id).order_by(Photo.is_cover.desc(), Photo.id.desc())
            )
        ).scalars().all()
        return [_photo_out(ph) for ph in rows]


@app.post("/plants/{plant_id}/photos", response_model=PhotoOut)
async def add_photo(plant_id: int, body: PhotoIn, x_user: str | None = Header(default=None)):
    async with Session() as s:
        _user, p = await _owned_plant(s, plant_id, x_user)
        existing = (await s.execute(select(Photo).where(Photo.plant_id == plant_id))).scalars().all()
        is_cover = len(existing) == 0
        ph = Photo(
            plant_id=plant_id,
            data=body.data,
            thumb=body.thumb or body.data,
            caption=body.caption.strip()[:200],
            is_cover=is_cover,
            uploaded_by=_user.slug,
        )
        s.add(ph)
        if is_cover:
            p.thumbnail = ph.thumb
        await s.commit()
        await s.refresh(ph)
        return _photo_out(ph)


@app.get("/photos/{photo_id}/full")
async def photo_full(photo_id: int):
    async with Session() as s:
        ph = await s.get(Photo, photo_id)
        if not ph:
            raise HTTPException(404, "Not found.")
        raw, ext = _decode_data_uri(ph.data or ph.thumb)
        return Response(
            content=raw,
            media_type=_MIME.get(ext, "image/jpeg"),
            headers={"Content-Disposition": f'inline; filename="photo-{photo_id}.{ext}"'},
        )


@app.patch("/photos/{photo_id}", response_model=PhotoOut)
async def update_photo(photo_id: int, body: PhotoPatch, x_user: str | None = Header(default=None)):
    async with Session() as s:
        ph = await s.get(Photo, photo_id)
        if not ph:
            raise HTTPException(404, "Not found.")
        _user, p = await _owned_plant(s, ph.plant_id, x_user)
        if body.caption is not None:
            ph.caption = body.caption.strip()[:200]
        if body.is_cover:
            others = (await s.execute(select(Photo).where(Photo.plant_id == ph.plant_id))).scalars().all()
            for o in others:
                o.is_cover = o.id == ph.id
            p.thumbnail = ph.thumb
        await s.commit()
        await s.refresh(ph)
        return _photo_out(ph)


@app.delete("/photos/{photo_id}")
async def delete_photo(photo_id: int, x_user: str | None = Header(default=None)):
    async with Session() as s:
        ph = await s.get(Photo, photo_id)
        if not ph:
            raise HTTPException(404, "Not found.")
        _user, p = await _owned_plant(s, ph.plant_id, x_user)
        was_cover = ph.is_cover
        await s.delete(ph)
        await s.flush()
        if was_cover:
            nxt = (
                await s.execute(select(Photo).where(Photo.plant_id == p.id).order_by(Photo.id.desc()))
            ).scalars().first()
            p.thumbnail = nxt.thumb if nxt else ""
            if nxt:
                nxt.is_cover = True
        await s.commit()
        return {"ok": True}


@app.get("/export")
async def export_photos(
    scope: str = "mine",
    id: int | None = None,
    user: str | None = None,
    x_user: str | None = Header(default=None),
):
    """Download a ZIP of photos (openable on iPhone via Files). scope=plant|mine|family|all.
    `user` query param is accepted so a plain download link works (no custom header needed)."""
    async with Session() as s:
        q = select(Plant).options(selectinload(Plant.photos), selectinload(Plant.owner))
        if scope == "plant":
            q = q.where(Plant.id == id)
        elif scope == "family":
            q = q.where(Plant.visibility == "family")
        elif scope == "all":
            pass
        elif scope == "mine":
            u = await _require_user(s, x_user or user)
            q = q.where(Plant.owner_id == u.id)
        else:
            raise HTTPException(400, "Bad scope.")
        plants = (await s.execute(q)).scalars().all()
        buf = io.BytesIO()
        n = 0
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for p in plants:
                base = _safe(p.nickname or p.common_name or p.species)
                for i, ph in enumerate(sorted(p.photos, key=lambda x: x.id), 1):
                    raw, ext = _decode_data_uri(ph.data or ph.thumb)
                    if not raw:
                        continue
                    tag = "_cover" if ph.is_cover else ""
                    z.writestr(f"{p.owner.slug}/{base}-{p.id}/{base}-{i}{tag}.{ext}", raw)
                    n += 1
        if n == 0:
            raise HTTPException(404, "No photos to export yet.")
        return Response(
            content=buf.getvalue(),
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="rootwork-{_safe(scope)}-photos.zip"'},
        )


@app.get("/")
async def index():
    return FileResponse(STATIC / "index.html")


app.mount("/", StaticFiles(directory=STATIC), name="static")
