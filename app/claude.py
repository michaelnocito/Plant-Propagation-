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
    "light": {{
      "floor": "the DIMMEST light it merely survives in (be specific about placement/intensity, e.g. '~3 ft from a north window — survives but growth stalls and gets leggy'). Do NOT just say 'low light'.",
      "thriving": "the light zone where it actually FLOURISHES — specific (e.g. 'bright indirect, an east window or 2-3 ft back from a south/west one; ~6 hrs of bright ambient')",
      "ceiling": "the BRIGHTEST it can take before leaf damage (e.g. 'a few hrs of direct morning sun is fine; harsh midday/afternoon sun scorches')"
    }},
    "temp": {{
      "min_f": integer °F below which it suffers cold damage,
      "ideal_low_f": integer °F (low end of the thriving band),
      "ideal_high_f": integer °F (high end of the thriving band),
      "max_f": integer °F above which it suffers heat stress,
      "note": "what to avoid (cold drafts, AC/heat vents, cold glass)"
    }},
    "soil_store_bought": "the bagged all-in-one to grab + what to read on the label (e.g. 'a peat/coir all-purpose indoor potting mix with perlite — avoid garden soil or heavy 6-month feed'). Name product TYPES, examples ok.",
    "soil_diy": "a mix-it-yourself recipe in PARTS with what each ingredient does (e.g. '2 parts coir + 1 part perlite + 1 part bark — coir holds water, perlite/bark add air')",
    "soil_short": "ONE short line naming the soil to use (e.g. 'Chunky, well-draining aroid mix')",
    "watering": "describe by soil feel ('water when top X inches are dry'), how to water, and the over- vs under-water tells",
    "water_short": "ONE short line (e.g. 'When top 2 in. dry — roughly weekly')",
    "humidity": "target range + how to raise it if needed",
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
  "edible": {{
    "status": "edible | parts_edible | not_edible | toxic",
    "score": 0-10 integer (how worthwhile/palatable to eat; 0 if not edible or toxic),
    "summary": "one honest line — what's edible, or why you shouldn't eat it",
    "edible_parts": "which parts are edible AND which parts to avoid (empty if none edible)",
    "forage": "the EASIEST beginner way + best season to find/harvest it (empty if not edible)",
    "prepare": "the EASIEST beginner way to prepare/eat it (empty if not edible)",
    "caution": "the real safety risks: toxic parts, poisonous LOOKALIKES, must-cook, raw toxicity, allergy/quantity limits"
  }},
  "marketability": {{
    "score": 1-10 integer (sellability of CUTTINGS / propagations on Etsy/FB Marketplace),
    "demand": "low | medium | high",
    "est_price_range": "e.g. $5-12 per cutting",
    "rarity": "common | uncommon | rare",
    "propagation_ease": "easy | moderate | hard",
    "sell_notes": "one line: pitch + best venue"
  }},
  "established": {{
    "score": 1-10 integer (sellability of the WHOLE ESTABLISHED/POTTED plant, not cuttings),
    "demand": "low | medium | high",
    "est_price_range": "price for a healthy established specimen, e.g. $35-90",
    "best_size_to_sell": "the size/stage that fetches the best price, e.g. '6in pot, 2-3 ft, full'",
    "sell_notes": "one line: pitch + best venue for selling the whole plant"
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

LIGHT & TEMPERATURE must be RANGES with a real thriving zone — never a single vague word
like "low light". If a plant only survives (but won't thrive) in dim light, say that in
"floor" and put where it's happiest in "thriving". Make placements concrete.

EDIBLE — be conservative and safety-first. If any part is toxic, use status "toxic" or
"parts_edible" and warn clearly (danger to children and pets). If you are not confident a plant
is safely edible, use "not_edible". ALWAYS fill "caution" with the real risks — especially
poisonous lookalikes and toxic parts. Foraging/prep must be the genuinely easiest beginner method.
Never imply that an app photo ID is enough to safely eat a wild plant.

RESALE: rate "marketability" for CUTTINGS (yield + price-per-cutting + demand) and "established"
for the WHOLE potted plant — they often differ (slow rare plants sell better whole; fast easy
plants sell better as cheap cuttings).

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
        max_tokens=4500,
        messages=[{"role": "user", "content": content}],
    )
    text = "".join(b.text for b in msg.content if b.type == "text")
    text = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    return PropResult.model_validate(json.loads(text))


SOIL_PROMPT = """You price a bag of houseplant soil mix for resale (Etsy / FB Marketplace / local plant sales).
Mix name: {name}
Bag size: {size}
Ingredients: {ingredients}
Good for: {suits}

Return ONLY a JSON object (no markdown) with these exact keys:
{{
  "score": 1-10 integer (how sellable THIS bag is — chunky aroid/specialty blends sell best; plain all-purpose is low),
  "demand": "low | medium | high",
  "est_price_range": "realistic price for this bag SIZE, e.g. $8-14",
  "sell_notes": "one line: who buys it + best venue + a pricing or presentation tip"
}}
Price from the bag size and ingredient cost (bark, pumice, charcoal, worm castings raise value; plain peat/coir is cheap). Output JSON only."""


async def appraise_soil(name: str, size: str, recipe: dict) -> dict:
    ings = ", ".join(
        f"{(i.get('parts') or '').strip()} {(i.get('name') or '').strip()}".strip()
        for i in (recipe.get("ingredients") or [])
    ) or "unspecified"
    suits = ", ".join(recipe.get("suits") or []) or "general houseplants"
    msg = await client.messages.create(
        model=MODEL,
        max_tokens=400,
        messages=[{"role": "user", "content": SOIL_PROMPT.format(
            name=name or "house plant soil mix", size=size or "1 quart", ingredients=ings, suits=suits)}],
    )
    text = "".join(b.text for b in msg.content if b.type == "text")
    text = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    return json.loads(text)
