import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from .claude import enrich
from .db import MEMBERS, Plant, Session, get_user, init_db
from .models import CATEGORIES, VISIBILITIES, PlantIn, PlantOut, PlantPatch
from .plantid import IDError, identify


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


@app.get("/")
async def index():
    return FileResponse(STATIC / "index.html")


app.mount("/", StaticFiles(directory=STATIC), name="static")
