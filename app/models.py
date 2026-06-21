from pydantic import BaseModel, Field


class Marketability(BaseModel):
    score: int = Field(ge=1, le=10)
    demand: str
    est_price_range: str
    rarity: str
    propagation_ease: str
    sell_notes: str


class PropResult(BaseModel):
    species: str
    common_name: str
    confidence: float = 0.0
    method: str
    difficulty: str
    timeline: str
    steps: list[str]
    diagram_svg: str
    marketability: Marketability
