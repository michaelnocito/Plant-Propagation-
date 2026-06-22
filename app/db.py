"""SQLite (async) store for saved plants + the two fixed family members.

DB lives at $DB_PATH (a Render persistent disk in prod, a local file in dev).
"""
import os
from datetime import datetime

from sqlalchemy import ForeignKey, String, Text, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, selectinload

def _resolve_db_path() -> str:
    """Use $DB_PATH (the persistent disk in prod). If its directory isn't writable
    yet — e.g. the disk hasn't been attached — fall back to a local file so the app
    still boots instead of crashing (data is ephemeral until the disk is mounted)."""
    p = os.environ.get("DB_PATH", "rootwork.db")
    d = os.path.dirname(p)
    if d:
        try:
            os.makedirs(d, exist_ok=True)
            probe = os.path.join(d, ".write_test")
            with open(probe, "w") as f:
                f.write("x")
            os.remove(probe)
        except OSError:
            p = os.path.basename(p) or "rootwork.db"
    return p


DB_PATH = _resolve_db_path()
engine = create_async_engine(f"sqlite+aiosqlite:///{DB_PATH}")
Session = async_sessionmaker(engine, expire_on_commit=False)

# The whole household. Slug is the stable identity key stored in the phone.
MEMBERS = [
    {"slug": "mike", "display_name": "Mike", "color": "#c0703a"},
    {"slug": "kelly", "display_name": "Kelly", "color": "#5f8d6b"},
]


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(32), unique=True)
    display_name: Mapped[str] = mapped_column(String(64))
    color: Mapped[str] = mapped_column(String(16))
    plants: Mapped[list["Plant"]] = relationship(back_populates="owner")


class Plant(Base):
    __tablename__ = "plants"
    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    visibility: Mapped[str] = mapped_column(String(16), default="private")  # private | family
    category: Mapped[str] = mapped_column(String(24), default="houseplants")
    species: Mapped[str] = mapped_column(String(160), default="")
    common_name: Mapped[str] = mapped_column(String(160), default="")
    nickname: Mapped[str] = mapped_column(String(80), default="")
    ai_result: Mapped[str] = mapped_column(Text)  # full saved AI response, JSON string
    thumbnail: Mapped[str] = mapped_column(Text, default="")  # small base64 data URI
    in_market: Mapped[bool] = mapped_column(default=False)  # listed on the family marketplace
    sold: Mapped[bool] = mapped_column(default=False)  # sold — hidden from the active marketplace
    props_in_progress: Mapped[int] = mapped_column(default=0)  # cuttings currently rooting
    cost: Mapped[float] = mapped_column(default=0.0)  # what we paid for it
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    owner: Mapped[User] = relationship(back_populates="plants")
    photos: Mapped[list["Photo"]] = relationship(
        back_populates="plant", cascade="all, delete-orphan"
    )


class Photo(Base):
    __tablename__ = "photos"
    id: Mapped[int] = mapped_column(primary_key=True)
    plant_id: Mapped[int] = mapped_column(ForeignKey("plants.id"), index=True)
    data: Mapped[str] = mapped_column(Text)  # full-ish JPEG data URI (~1024px) — the backup-quality copy
    thumb: Mapped[str] = mapped_column(Text, default="")  # small data URI (~160px) for grids/gallery
    caption: Mapped[str] = mapped_column(String(200), default="")
    is_cover: Mapped[bool] = mapped_column(default=False)
    uploaded_by: Mapped[str] = mapped_column(String(32), default="")
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    plant: Mapped[Plant] = relationship(back_populates="photos")


class SoilPack(Base):
    """A batch of soil mix Kelly/Mike make — tracked & sold like plants (no AI analysis)."""

    __tablename__ = "soil_packs"
    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(120), default="")  # e.g. "Chunky Aroid Mix"
    recipe_key: Mapped[str] = mapped_column(String(48), default="")  # built-in recipe id, or "custom"
    size: Mapped[str] = mapped_column(String(48), default="")  # e.g. "2 qt bag"
    recipe: Mapped[str] = mapped_column(Text, default="{}")  # JSON snapshot {ingredients, suits, ...}
    market: Mapped[str] = mapped_column(Text, default="{}")  # JSON {score, demand, est_price_range, sell_notes}
    notes: Mapped[str] = mapped_column(Text, default="")
    thumbnail: Mapped[str] = mapped_column(Text, default="")  # small base64 data URI
    visibility: Mapped[str] = mapped_column(String(16), default="private")
    in_market: Mapped[bool] = mapped_column(default=False)
    sold: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    owner: Mapped[User] = relationship()


async def _ensure_columns(conn) -> None:
    """Tiny forward-only migration: add columns missing from an existing plants table
    (create_all only creates missing TABLES, not new columns on existing ones)."""
    from sqlalchemy import text

    cols = {r[1] for r in (await conn.exec_driver_sql("PRAGMA table_info(plants)")).all()}
    if "in_market" not in cols:
        await conn.execute(text("ALTER TABLE plants ADD COLUMN in_market BOOLEAN DEFAULT 0 NOT NULL"))
    if "sold" not in cols:
        await conn.execute(text("ALTER TABLE plants ADD COLUMN sold BOOLEAN DEFAULT 0 NOT NULL"))
    if "props_in_progress" not in cols:
        await conn.execute(text("ALTER TABLE plants ADD COLUMN props_in_progress INTEGER DEFAULT 0 NOT NULL"))
    if "cost" not in cols:
        await conn.execute(text("ALTER TABLE plants ADD COLUMN cost REAL DEFAULT 0 NOT NULL"))


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _ensure_columns(conn)
    async with Session() as s:
        existing = {u.slug for u in (await s.execute(select(User))).scalars()}
        for m in MEMBERS:
            if m["slug"] not in existing:
                s.add(User(**m))
        await s.commit()
        # backfill: turn a legacy single thumbnail into a cover Photo so nothing is lost
        plants = (
            await s.execute(select(Plant).options(selectinload(Plant.photos), selectinload(Plant.owner)))
        ).scalars().all()
        for p in plants:
            if p.thumbnail and not p.photos:
                s.add(
                    Photo(
                        plant_id=p.id, data=p.thumbnail, thumb=p.thumbnail,
                        is_cover=True, uploaded_by=p.owner.slug,
                    )
                )
        await s.commit()


async def get_user(s: AsyncSession, slug: str) -> User | None:
    return (await s.execute(select(User).where(User.slug == slug))).scalar_one_or_none()
