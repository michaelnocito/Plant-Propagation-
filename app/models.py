from pydantic import BaseModel, Field


class Marketability(BaseModel):
    """Sellability of propagated cuttings."""

    score: int = Field(ge=1, le=10)
    demand: str
    est_price_range: str
    rarity: str
    propagation_ease: str
    sell_notes: str


class EstablishedResale(BaseModel):
    """Sellability of the whole established/potted plant (not cuttings)."""

    score: int = Field(ge=1, le=10)
    demand: str
    est_price_range: str  # for a healthy, established specimen
    best_size_to_sell: str  # e.g. "6in pot, 2-3 ft tall"
    sell_notes: str


class Light(BaseModel):
    """Light as a survives→thrives→too-much range, not a vague label."""

    floor: str    # dimmest it tolerates (survives, won't thrive) — be specific
    thriving: str  # the zone where it actually flourishes
    ceiling: str  # brightest it can take before leaf damage


class Temp(BaseModel):
    """Temperature band in °F: cold-damage floor → thriving band → heat-stress ceiling."""

    min_f: int      # below this = cold damage
    ideal_low_f: int
    ideal_high_f: int
    max_f: int      # above this = heat stress
    note: str = ""


class Care(BaseModel):
    """Everything needed to keep this plant thriving."""

    light: Light
    temp: Temp
    soil_store_bought: str  # the all-in-one bagged option + what to look for
    soil_diy: str  # a mix recipe in parts
    soil_short: str  # one-line soil pick for the summary view
    watering: str
    water_short: str  # one-line watering for the summary view
    humidity: str
    feeding: str


class DiagnosisIssue(BaseModel):
    condition: str  # e.g. "Root rot", "Spider mites", "Underwatered"
    severity: str  # low | medium | high
    signs: str  # what is visible in THIS photo that points to it
    action: str  # concrete in-app fix steps (the blurb)
    home_remedy: str = ""  # optional pantry/home fix
    learn_query: str = ""  # search phrase for a "how to fix" link


class Diagnosis(BaseModel):
    status: str  # healthy | watch | issue
    summary: str  # one-line read of how the plant looks in the photo
    issues: list[DiagnosisIssue] = []


class Edible(BaseModel):
    """Can you eat it — and if so, the easiest forage + prep. Safety-first."""

    status: str  # edible | parts_edible | not_edible | toxic
    score: int = Field(ge=0, le=10)  # palatability/worth (0 if not edible)
    summary: str
    edible_parts: str = ""  # which parts are edible (and which are NOT)
    forage: str = ""  # easiest way + best season to find/harvest
    prepare: str = ""  # easiest beginner preparation
    caution: str = ""  # toxic parts, poisonous lookalikes, must-cook, limits


class PropResult(BaseModel):
    species: str
    common_name: str
    confidence: float = 0.0
    method: str
    difficulty: str
    timeline: str
    steps: list[str]
    diagram_svg: str
    care: Care
    edible: Edible
    # filled on-demand (kept out of the initial import for speed):
    diagnosis: Diagnosis | None = None
    marketability: Marketability | None = None  # cuttings / propagation resale
    established: EstablishedResale | None = None  # whole-plant resale


# ---- saved-plant collection ----

CATEGORIES = {"houseplants", "propagating", "outdoor", "for_sale", "wishlist"}
VISIBILITIES = {"private", "family"}


class PlantIn(BaseModel):
    visibility: str = "private"
    category: str = "houseplants"
    nickname: str = ""
    species: str = ""
    common_name: str = ""
    ai_result: dict  # the full PropResult payload as saved
    thumbnail: str = ""  # small base64 data URI
    in_market: bool = False  # listed on the family marketplace
    cost: float = 0.0  # what we paid for it


class PlantPatch(BaseModel):
    visibility: str | None = None
    category: str | None = None
    nickname: str | None = None
    in_market: bool | None = None
    sold: bool | None = None
    props_in_progress: int | None = None
    cost: float | None = None
    thumbnail: str | None = None  # replace / clear the photo
    ai_result: dict | None = None  # merge in on-demand pricing/diagnosis later


class PhotoIn(BaseModel):
    data: str  # full-ish JPEG data URI (~1024px)
    thumb: str = ""  # small data URI (~160px)
    caption: str = ""


class PhotoPatch(BaseModel):
    caption: str | None = None
    is_cover: bool | None = None


class PhotoOut(BaseModel):
    id: int
    plant_id: int
    thumb: str  # small; full data fetched via /photos/{id}/full
    caption: str
    is_cover: bool
    uploaded_by: str
    created_at: str


class PlantOut(BaseModel):
    id: int
    owner: str  # slug
    owner_name: str
    owner_color: str
    visibility: str
    category: str
    nickname: str
    species: str
    common_name: str
    ai_result: dict
    thumbnail: str
    in_market: bool
    sold: bool
    props_in_progress: int
    cost: float
    created_at: str


# ---- soil packs (tracked & sold like plants; no AI analysis) ----


class AppraiseIn(BaseModel):
    species: str
    common_name: str = ""


class SoilMarket(BaseModel):
    """Appraised resale read for a bag of mix."""

    score: int = Field(ge=1, le=10)
    demand: str
    est_price_range: str
    sell_notes: str


class SoilAppraiseIn(BaseModel):
    name: str
    size: str = ""
    recipe: dict = {}  # {ingredients:[{name,parts}], suits:[...]}


class SoilPackIn(BaseModel):
    name: str
    recipe_key: str = ""
    size: str = ""
    recipe: dict = {}
    market: dict = {}
    notes: str = ""
    thumbnail: str = ""
    visibility: str = "private"
    in_market: bool = False


class SoilPackPatch(BaseModel):
    name: str | None = None
    size: str | None = None
    notes: str | None = None
    thumbnail: str | None = None
    visibility: str | None = None
    in_market: bool | None = None
    sold: bool | None = None
    market: dict | None = None


class SoilPackOut(BaseModel):
    id: int
    owner: str
    owner_name: str
    owner_color: str
    name: str
    recipe_key: str
    size: str
    recipe: dict
    market: dict
    notes: str
    thumbnail: str
    visibility: str
    in_market: bool
    sold: bool
    created_at: str
