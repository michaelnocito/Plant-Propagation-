import base64
import io
import json
import re
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from .claude import (
    appraise_plant,
    appraise_seed,
    appraise_soil,
    diagnose_plant,
    diagram_plant,
    edible_plant,
    enrich_core,
    sync_recipes,
)
from .db import MEMBERS, Photo, Plant, Seed, Session, SoilPack, User, get_user, init_db
from .models import (
    CATEGORIES,
    VISIBILITIES,
    AppraiseIn,
    DiagramIn,
    PhotoIn,
    PhotoOut,
    PhotoPatch,
    PlantIn,
    PlantOut,
    PlantPatch,
    SeedAppraiseIn,
    SeedIn,
    SeedOut,
    SeedPatch,
    SoilAppraiseIn,
    SoilPackIn,
    SoilPackOut,
    SoilPackPatch,
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
        result = await enrich_core(species, common)  # fast: care + propagation + edible (no pricing/diagnosis)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Enrich failed: {e}") from e
    result.confidence = round(score, 2)
    return result


@app.post("/appraise")
async def appraise(body: AppraiseIn):
    """On-demand resale pricing (cuttings + whole plant) — fast, no photo."""
    try:
        return await appraise_plant(body.species, body.common_name)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Appraise failed: {e}") from e


@app.post("/edible")
async def edible(body: AppraiseIn):
    """On-demand edibility / foraging info."""
    try:
        return await edible_plant(body.species, body.common_name)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Edible failed: {e}") from e


@app.post("/diagram")
async def diagram(body: DiagramIn):
    """On-demand propagation diagram (the app loads this in the background)."""
    try:
        return await diagram_plant(body.species, body.common_name, body.method)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Diagram failed: {e}") from e


@app.post("/diagnose")
async def diagnose(file: UploadFile, species: str = Form(...), common_name: str = Form("")):
    """On-demand health check from a photo."""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Send an image.")
    data = await file.read()
    try:
        return await diagnose_plant(species, common_name, data, file.content_type)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Diagnose failed: {e}") from e


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
        cost=p.cost,
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
            cost=max(0.0, body.cost or 0.0),
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
        if body.cost is not None:
            p.cost = max(0.0, body.cost)
        if body.thumbnail is not None:
            p.thumbnail = body.thumbnail
        if body.ai_result is not None:
            p.ai_result = json.dumps(body.ai_result)
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


# ---- soil packs (tracked & sold like plants; no AI analysis) ----


def _soil_out(sp: SoilPack) -> SoilPackOut:
    return SoilPackOut(
        id=sp.id,
        owner=sp.owner.slug,
        owner_name=sp.owner.display_name,
        owner_color=sp.owner.color,
        name=sp.name,
        recipe_key=sp.recipe_key,
        size=sp.size,
        recipe=json.loads(sp.recipe or "{}"),
        market=json.loads(sp.market or "{}"),
        notes=sp.notes,
        thumbnail=sp.thumbnail,
        visibility=sp.visibility,
        in_market=sp.in_market,
        sold=sp.sold,
        created_at=sp.created_at.isoformat(),
    )


@app.post("/recipes/sync")
async def recipes_sync(body: dict):
    """Web-grounded check for soil-recipe / best-practice updates -> review proposals."""
    try:
        return await sync_recipes(body.get("recipes", ""))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Sync failed: {e}") from e


@app.post("/soil/appraise")
async def soil_appraise(body: SoilAppraiseIn):
    """Market value for a bag of mix (no plant analysis — just pricing)."""
    try:
        return await appraise_soil(body.name, body.size, body.recipe)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Appraise failed: {e}") from e


@app.post("/soil", response_model=SoilPackOut)
async def create_soil(body: SoilPackIn, x_user: str | None = Header(default=None)):
    if body.visibility not in VISIBILITIES:
        raise HTTPException(400, "Bad visibility.")
    market = body.market
    if not market:
        try:
            market = await appraise_soil(body.name, body.size, body.recipe)
        except Exception:  # noqa: BLE001
            market = {}
    async with Session() as s:
        user = await _require_user(s, x_user)
        sp = SoilPack(
            owner_id=user.id,
            name=body.name.strip()[:120],
            recipe_key=body.recipe_key.strip()[:48],
            size=body.size.strip()[:48],
            recipe=json.dumps(body.recipe),
            market=json.dumps(market),
            notes=body.notes.strip(),
            thumbnail=body.thumbnail,
            visibility=body.visibility,
            in_market=body.in_market,
        )
        s.add(sp)
        await s.commit()
        await s.refresh(sp, ["owner"])
        return _soil_out(sp)


@app.get("/soil/mine", response_model=list[SoilPackOut])
async def my_soil(x_user: str | None = Header(default=None)):
    async with Session() as s:
        user = await _require_user(s, x_user)
        rows = (
            await s.execute(
                select(SoilPack).options(selectinload(SoilPack.owner))
                .where(SoilPack.owner_id == user.id).order_by(SoilPack.created_at.desc())
            )
        ).scalars().all()
        return [_soil_out(sp) for sp in rows]


@app.get("/soil/family", response_model=list[SoilPackOut])
async def family_soil():
    async with Session() as s:
        rows = (
            await s.execute(
                select(SoilPack).options(selectinload(SoilPack.owner))
                .where(SoilPack.visibility == "family").order_by(SoilPack.created_at.desc())
            )
        ).scalars().all()
        return [_soil_out(sp) for sp in rows]


@app.get("/soil/market", response_model=list[SoilPackOut])
async def market_soil():
    """Soil batches listed on the marketplace (both owners)."""
    async with Session() as s:
        rows = (
            await s.execute(
                select(SoilPack).options(selectinload(SoilPack.owner))
                .where(SoilPack.in_market.is_(True)).order_by(SoilPack.created_at.desc())
            )
        ).scalars().all()
        return [_soil_out(sp) for sp in rows]


@app.patch("/soil/{soil_id}", response_model=SoilPackOut)
async def update_soil(soil_id: int, body: SoilPackPatch, x_user: str | None = Header(default=None)):
    async with Session() as s:
        user = await _require_user(s, x_user)
        sp = await s.get(SoilPack, soil_id)
        if not sp or sp.owner_id != user.id:
            raise HTTPException(404, "Not found.")
        if body.name is not None:
            sp.name = body.name.strip()[:120]
        if body.size is not None:
            sp.size = body.size.strip()[:48]
        if body.notes is not None:
            sp.notes = body.notes.strip()
        if body.thumbnail is not None:
            sp.thumbnail = body.thumbnail
        if body.visibility is not None:
            if body.visibility not in VISIBILITIES:
                raise HTTPException(400, "Bad visibility.")
            sp.visibility = body.visibility
        if body.in_market is not None:
            sp.in_market = body.in_market
        if body.sold is not None:
            sp.sold = body.sold
        if body.market is not None:
            sp.market = json.dumps(body.market)
        await s.commit()
        await s.refresh(sp, ["owner"])
        return _soil_out(sp)


@app.delete("/soil/{soil_id}")
async def delete_soil(soil_id: int, x_user: str | None = Header(default=None)):
    async with Session() as s:
        user = await _require_user(s, x_user)
        sp = await s.get(SoilPack, soil_id)
        if not sp or sp.owner_id != user.id:
            raise HTTPException(404, "Not found.")
        await s.delete(sp)
        await s.commit()
        return {"ok": True}


# ---- seeds (tracked & sold like plants; AI market appraisal, no analysis) ----


def _seed_out(sd: Seed) -> SeedOut:
    return SeedOut(
        id=sd.id, owner=sd.owner.slug, owner_name=sd.owner.display_name, owner_color=sd.owner.color,
        name=sd.name, source=sd.source, quantity=sd.quantity, market=json.loads(sd.market or "{}"),
        notes=sd.notes, thumbnail=sd.thumbnail, visibility=sd.visibility, in_market=sd.in_market,
        sold=sd.sold, created_at=sd.created_at.isoformat(),
    )


@app.post("/seeds/appraise")
async def seed_appraise(body: SeedAppraiseIn):
    try:
        return await appraise_seed(body.name, body.notes)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Appraise failed: {e}") from e


@app.post("/seeds", response_model=SeedOut)
async def create_seed(body: SeedIn, x_user: str | None = Header(default=None)):
    if body.visibility not in VISIBILITIES:
        raise HTTPException(400, "Bad visibility.")
    market = body.market
    if not market:
        try:
            market = await appraise_seed(body.name, body.notes)
        except Exception:  # noqa: BLE001
            market = {}
    async with Session() as s:
        user = await _require_user(s, x_user)
        sd = Seed(
            owner_id=user.id, name=body.name.strip()[:120], source=body.source.strip()[:120],
            quantity=body.quantity.strip()[:48], market=json.dumps(market), notes=body.notes.strip(),
            thumbnail=body.thumbnail, visibility=body.visibility, in_market=body.in_market,
        )
        s.add(sd)
        await s.commit()
        await s.refresh(sd, ["owner"])
        return _seed_out(sd)


@app.get("/seeds/mine", response_model=list[SeedOut])
async def my_seeds(x_user: str | None = Header(default=None)):
    async with Session() as s:
        user = await _require_user(s, x_user)
        rows = (await s.execute(
            select(Seed).options(selectinload(Seed.owner)).where(Seed.owner_id == user.id).order_by(Seed.created_at.desc())
        )).scalars().all()
        return [_seed_out(sd) for sd in rows]


@app.get("/seeds/family", response_model=list[SeedOut])
async def family_seeds():
    async with Session() as s:
        rows = (await s.execute(
            select(Seed).options(selectinload(Seed.owner)).where(Seed.visibility == "family").order_by(Seed.created_at.desc())
        )).scalars().all()
        return [_seed_out(sd) for sd in rows]


@app.get("/seeds/market", response_model=list[SeedOut])
async def market_seeds():
    async with Session() as s:
        rows = (await s.execute(
            select(Seed).options(selectinload(Seed.owner)).where(Seed.in_market.is_(True)).order_by(Seed.created_at.desc())
        )).scalars().all()
        return [_seed_out(sd) for sd in rows]


@app.patch("/seeds/{seed_id}", response_model=SeedOut)
async def update_seed(seed_id: int, body: SeedPatch, x_user: str | None = Header(default=None)):
    async with Session() as s:
        user = await _require_user(s, x_user)
        sd = await s.get(Seed, seed_id)
        if not sd or sd.owner_id != user.id:
            raise HTTPException(404, "Not found.")
        if body.name is not None:
            sd.name = body.name.strip()[:120]
        if body.source is not None:
            sd.source = body.source.strip()[:120]
        if body.quantity is not None:
            sd.quantity = body.quantity.strip()[:48]
        if body.notes is not None:
            sd.notes = body.notes.strip()
        if body.thumbnail is not None:
            sd.thumbnail = body.thumbnail
        if body.visibility is not None:
            if body.visibility not in VISIBILITIES:
                raise HTTPException(400, "Bad visibility.")
            sd.visibility = body.visibility
        if body.in_market is not None:
            sd.in_market = body.in_market
        if body.sold is not None:
            sd.sold = body.sold
        if body.market is not None:
            sd.market = json.dumps(body.market)
        await s.commit()
        await s.refresh(sd, ["owner"])
        return _seed_out(sd)


@app.delete("/seeds/{seed_id}")
async def delete_seed(seed_id: int, x_user: str | None = Header(default=None)):
    async with Session() as s:
        user = await _require_user(s, x_user)
        sd = await s.get(Seed, seed_id)
        if not sd or sd.owner_id != user.id:
            raise HTTPException(404, "Not found.")
        await s.delete(sd)
        await s.commit()
        return {"ok": True}


# ---- backup / restore (full-data snapshot; survives redeploys) ----


@app.get("/backup")
async def backup():
    """Download every plant + soil batch (with photos) as one JSON file."""
    async with Session() as s:
        plants = (
            await s.execute(select(Plant).options(selectinload(Plant.owner), selectinload(Plant.photos)))
        ).scalars().all()
        soils = (await s.execute(select(SoilPack).options(selectinload(SoilPack.owner)))).scalars().all()
        seeds = (await s.execute(select(Seed).options(selectinload(Seed.owner)))).scalars().all()
        data = {
            "version": 1,
            "plants": [
                {
                    "owner": p.owner.slug, "visibility": p.visibility, "category": p.category,
                    "nickname": p.nickname, "species": p.species, "common_name": p.common_name,
                    "ai_result": json.loads(p.ai_result), "thumbnail": p.thumbnail,
                    "in_market": p.in_market, "sold": p.sold, "props_in_progress": p.props_in_progress,
                    "cost": p.cost,
                    "photos": [
                        {"data": ph.data, "thumb": ph.thumb, "caption": ph.caption,
                         "is_cover": ph.is_cover, "uploaded_by": ph.uploaded_by}
                        for ph in sorted(p.photos, key=lambda x: x.id)
                    ],
                }
                for p in plants
            ],
            "soil": [
                {
                    "owner": sp.owner.slug, "name": sp.name, "recipe_key": sp.recipe_key, "size": sp.size,
                    "recipe": json.loads(sp.recipe or "{}"), "market": json.loads(sp.market or "{}"),
                    "notes": sp.notes, "thumbnail": sp.thumbnail, "visibility": sp.visibility,
                    "in_market": sp.in_market, "sold": sp.sold,
                }
                for sp in soils
            ],
            "seeds": [
                {
                    "owner": sd.owner.slug, "name": sd.name, "source": sd.source, "quantity": sd.quantity,
                    "market": json.loads(sd.market or "{}"), "notes": sd.notes, "thumbnail": sd.thumbnail,
                    "visibility": sd.visibility, "in_market": sd.in_market, "sold": sd.sold,
                }
                for sd in seeds
            ],
        }
        return Response(
            content=json.dumps(data).encode(),
            media_type="application/json",
            headers={"Content-Disposition": 'attachment; filename="rootwork-backup.json"'},
        )


@app.post("/restore")
async def restore(body: dict):
    """Add everything from a backup file (non-destructive — inserts new rows)."""
    async with Session() as s:
        users = {u.slug: u for u in (await s.execute(select(User))).scalars()}
        n_plants = n_soil = 0
        for p in body.get("plants", []):
            u = users.get(p.get("owner"))
            if not u:
                continue
            plant = Plant(
                owner_id=u.id, visibility=p.get("visibility", "private"), category=p.get("category", "houseplants"),
                nickname=p.get("nickname", ""), species=p.get("species", ""), common_name=p.get("common_name", ""),
                ai_result=json.dumps(p.get("ai_result", {})), thumbnail=p.get("thumbnail", ""),
                in_market=bool(p.get("in_market")), sold=bool(p.get("sold")),
                props_in_progress=int(p.get("props_in_progress", 0) or 0),
                cost=float(p.get("cost", 0) or 0),
            )
            s.add(plant)
            await s.flush()
            for ph in p.get("photos", []):
                s.add(Photo(
                    plant_id=plant.id, data=ph.get("data", ""), thumb=ph.get("thumb", ""),
                    caption=ph.get("caption", ""), is_cover=bool(ph.get("is_cover")), uploaded_by=ph.get("uploaded_by", ""),
                ))
            n_plants += 1
        for sp in body.get("soil", []):
            u = users.get(sp.get("owner"))
            if not u:
                continue
            s.add(SoilPack(
                owner_id=u.id, name=sp.get("name", ""), recipe_key=sp.get("recipe_key", ""), size=sp.get("size", ""),
                recipe=json.dumps(sp.get("recipe", {})), market=json.dumps(sp.get("market", {})),
                notes=sp.get("notes", ""), thumbnail=sp.get("thumbnail", ""), visibility=sp.get("visibility", "private"),
                in_market=bool(sp.get("in_market")), sold=bool(sp.get("sold")),
            ))
            n_soil += 1
        n_seed = 0
        for sd in body.get("seeds", []):
            u = users.get(sd.get("owner"))
            if not u:
                continue
            s.add(Seed(
                owner_id=u.id, name=sd.get("name", ""), source=sd.get("source", ""), quantity=sd.get("quantity", ""),
                market=json.dumps(sd.get("market", {})), notes=sd.get("notes", ""), thumbnail=sd.get("thumbnail", ""),
                visibility=sd.get("visibility", "private"), in_market=bool(sd.get("in_market")), sold=bool(sd.get("sold")),
            ))
            n_seed += 1
        await s.commit()
        return {"plants": n_plants, "soil": n_soil, "seeds": n_seed}


@app.get("/")
async def index():
    return FileResponse(STATIC / "index.html")


app.mount("/", StaticFiles(directory=STATIC), name="static")
