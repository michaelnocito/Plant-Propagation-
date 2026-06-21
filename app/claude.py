import json

from anthropic import AsyncAnthropic

from .models import PropResult

client = AsyncAnthropic()  # reads ANTHROPIC_API_KEY from env

MODEL = "claude-sonnet-4-6"

PROMPT = """You are a horticulture + plant-resale expert. The plant has been identified as:
species: {species}
common name: {common}

Return ONLY a JSON object (no markdown, no prose) with these exact keys:

{{
  "species": "{species}",
  "common_name": "{common}",
  "method": "best propagation method (e.g. water cutting, soil cutting, division, offsets)",
  "difficulty": "easy | moderate | hard",
  "timeline": "e.g. roots in 2-4 weeks",
  "steps": ["short imperative step", "..."],
  "diagram_svg": "a self-contained inline SVG (viewBox 0 0 200 200, no external refs, 2-3 colors, simple line art) illustrating the propagation method",
  "marketability": {{
    "score": 1-10 integer (sellability of cuttings on Etsy/FB Marketplace),
    "demand": "low | medium | high",
    "est_price_range": "e.g. $5-12 per cutting",
    "rarity": "common | uncommon | rare",
    "propagation_ease": "easy | moderate | hard",
    "sell_notes": "one line: pitch + best venue"
  }}
}}

Rate marketability weighting demand, propagation yield, and price-per-cutting. Output JSON only."""


async def enrich(species: str, common: str) -> PropResult:
    msg = await client.messages.create(
        model=MODEL,
        max_tokens=2000,
        messages=[{"role": "user", "content": PROMPT.format(species=species, common=common)}],
    )
    text = "".join(b.text for b in msg.content if b.type == "text")
    text = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    return PropResult.model_validate(json.loads(text))
