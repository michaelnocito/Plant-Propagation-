import base64
import json

from anthropic import AsyncAnthropic

from .models import PropResult

client = AsyncAnthropic()  # reads ANTHROPIC_API_KEY from env

MODEL = "claude-sonnet-4-6"

# Anthropic vision accepts these; we coerce anything else to jpeg's label.
_VISION_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}

PROMPT = """You are a horticulture expert and plant-resale appraiser. A photo of the \
plant is attached. It has been identified as:
species: {species}
common name: {common}

You have TWO jobs:
1. Give complete, accurate, species-specific care + propagation guidance.
2. Look carefully AT THE ATTACHED PHOTO and diagnose how this individual plant is \
actually doing — based on what you can SEE (leaf color, spots, webbing, pests, soil, \
wilting, leggy growth, etc.), not generic worries.

Return ONLY a JSON object (no markdown, no prose) with these exact keys:

{{
  "species": "{species}",
  "common_name": "{common}",
  "method": "best propagation method (e.g. water cutting, soil cutting, division, offsets)",
  "difficulty": "easy | moderate | hard",
  "timeline": "e.g. roots in 2-4 weeks",
  "steps": ["short imperative step", "..."],
  "diagram_svg": "self-contained inline SVG (viewBox 0 0 200 200, no external refs, 2-3 colors, simple line art) of the propagation method",
  "care": {{
    "soil_store_bought": "the bagged all-in-one to grab + what to read on the label (e.g. 'a peat/coir all-purpose indoor potting mix with perlite — avoid garden soil or heavy 6-month feed'). Name product TYPES, examples ok.",
    "soil_diy": "a mix-it-yourself recipe in PARTS with what each ingredient does (e.g. '2 parts coir + 1 part perlite + 1 part bark — coir holds water, perlite/bark add air')",
    "sunlight": "light level in plain terms (bright direct / bright indirect / medium / low) + where to put it",
    "watering": "describe by soil feel ('water when top X inches are dry'), how to water, and the over- vs under-water tells",
    "humidity": "target range + how to raise it if needed",
    "temperature": "comfortable range + what to avoid (drafts, vents, cold glass)",
    "feeding": "fertilizer type, strength, and season/cadence"
  }},
  "diagnosis": {{
    "status": "healthy | watch | issue",
    "summary": "one honest line on how the plant looks in THIS photo",
    "issues": [
      {{
        "condition": "name it (e.g. Root rot, Spider mites, Underwatered, Sunburn, Leggy/low light)",
        "severity": "low | medium | high",
        "signs": "the SPECIFIC things visible in this photo that point to it",
        "action": "concrete fix steps the owner can do now — a real mini how-to, not 'it's diseased'",
        "home_remedy": "optional pantry/home fix if one genuinely applies",
        "learn_query": "short search phrase for a 'how to fix' link, e.g. 'how to treat root rot houseplant'"
      }}
    ]
  }},
  "marketability": {{
    "score": 1-10 integer (sellability of cuttings on Etsy/FB Marketplace),
    "demand": "low | medium | high",
    "est_price_range": "e.g. $5-12 per cutting",
    "rarity": "common | uncommon | rare",
    "propagation_ease": "easy | moderate | hard",
    "sell_notes": "one line: pitch + best venue"
  }}
}}

DIAGNOSIS RULES — be genuinely useful, and honest:
- If the plant looks healthy, say so: status "healthy", a reassuring summary, "issues": [].
- Only list problems you can actually see evidence for in the photo. Don't invent disease. \
If something is ambiguous, use status "watch" and say what to keep an eye on.
- For each issue, "action" must be a real remedy, grounded in horticulture:
  * Root rot / overwatering: unpot, trim black/mushy roots with an alcohol-sterilized blade, \
    rinse, repot in FRESH well-draining mix in a pot with drainage, then water less. (cinnamon \
    on cuts is an optional mild antifungal.) Fixing watering/drainage matters most.
  * Mealybugs / scale: dab each bug with a 70% rubbing-alcohol cotton swab, then insecticidal \
    soap weekly for several weeks; isolate the plant.
  * Spider mites / aphids: rinse undersides forcefully, then insecticidal soap or neem every \
    5-7 days; raise humidity for mites.
  * Fungus gnats: let the top 1-2 inches of soil dry out, yellow sticky traps, BTi drench.
  * Fungal leaf spot / mildew: remove affected leaves, stop wetting foliage, improve airflow.
  * Underwatered: water thoroughly / bottom-water if soil is hydrophobic.
  * Sunburn or too-little-light: move/adjust light; trim damaged leaves (they won't recover).
- Prefer commercial insecticidal soap over DIY dish-soap sprays (homemade can burn leaves).

Order the steps and care for a beginner. Output JSON only."""


def _media_type(content_type: str | None) -> str:
    if content_type in _VISION_TYPES:
        return content_type
    return "image/jpeg"


async def enrich(species: str, common: str, image: bytes, content_type: str | None) -> PropResult:
    b64 = base64.standard_b64encode(image).decode()
    content = [
        {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": _media_type(content_type),
                "data": b64,
            },
        },
        {"type": "text", "text": PROMPT.format(species=species, common=common)},
    ]
    msg = await client.messages.create(
        model=MODEL,
        max_tokens=3500,
        messages=[{"role": "user", "content": content}],
    )
    text = "".join(b.text for b in msg.content if b.type == "text")
    text = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    return PropResult.model_validate(json.loads(text))
