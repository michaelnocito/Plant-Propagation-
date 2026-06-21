from pydantic import BaseModel, Field


class Marketability(BaseModel):
    score: int = Field(ge=1, le=10)
    demand: str
    est_price_range: str
    rarity: str
    propagation_ease: str
    sell_notes: str


class Care(BaseModel):
    """Everything needed to keep this plant thriving."""

    soil_store_bought: str  # the all-in-one bagged option + what to look for
    soil_diy: str  # a mix recipe in parts
    sunlight: str
    watering: str
    humidity: str
    temperature: str
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
    diagnosis: Diagnosis
    marketability: Marketability
