import base64
import json

from anthropic import AsyncAnthropic

from .models import PropResult

client = AsyncAnthropic()  # reads ANTHROPIC_API_KEY from env

MODEL = "claude-sonnet-4-6"

# Anthropic vision accepts these; we coerce anything else to jpeg's label.
_VISION_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}

# --- CORE: identity + care + propagation + edible (text-only, fast — the initial import) ---
CORE_PROMPT = """You are a horticulture expert. The plant has been identified as:
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
  "care": {{
    "light": {{
      "floor": "the DIMMEST light it merely survives in (be specific, e.g. '~3 ft from a north window — survives but growth stalls'). Do NOT just say 'low light'.",
      "thriving": "the light zone where it actually FLOURISHES — specific (e.g. 'bright indirect, an east window or 2-3 ft back from a south/west one')",
      "ceiling": "the BRIGHTEST it can take before leaf damage (e.g. 'a few hrs of direct morning sun is fine; harsh afternoon sun scorches')"
    }},
    "temp": {{
      "min_f": integer °F below which it suffers cold damage,
      "ideal_low_f": integer °F (low end of the thriving band),
      "ideal_high_f": integer °F (high end of the thriving band),
      "max_f": integer °F above which it suffers heat stress,
      "note": "what to avoid (cold drafts, AC/heat vents, cold glass)"
    }},
    "soil_store_bought": "the bagged all-in-one to grab + what to read on the label. Name product TYPES, examples ok.",
    "soil_diy": "a mix-it-yourself recipe in PARTS with what each ingredient does",
    "soil_short": "ONE short line naming the soil to use",
    "watering": "describe by soil feel ('water when top X inches are dry'), how to water, and the over- vs under-water tells",
    "water_short": "ONE short line (e.g. 'When top 2 in. dry — roughly weekly')",
    "humidity": "target range + how to raise it if needed",
    "feeding": "fertilizer type, strength, and season/cadence"
  }}
}}

LIGHT & TEMPERATURE must be RANGES with a real thriving zone — never a vague "low light".
Order steps/care for a beginner. Output JSON only."""

# --- APPRAISE: resale pricing (text-only, on-demand) ---
APPRAISE_PROMPT = """You are a plant-resale appraiser. The plant is:
species: {species}
common name: {common}

Return ONLY a JSON object (no markdown) with these exact keys:
{{
  "marketability": {{
    "score": 1-10 integer (sellability of CUTTINGS / propagations on Etsy/FB Marketplace),
    "demand": "low | medium | high",
    "est_price_range": "e.g. $5-12 per cutting",
    "rarity": "common | uncommon | rare",
    "propagation_ease": "easy | moderate | hard",
    "sell_notes": "one line: pitch + best venue"
  }},
  "established": {{
    "score": 1-10 integer (sellability of the WHOLE ESTABLISHED/POTTED plant),
    "demand": "low | medium | high",
    "est_price_range": "price for a healthy established specimen, e.g. $35-90",
    "best_size_to_sell": "the size/stage that fetches the best price, e.g. '6in pot, 2-3 ft, full'",
    "sell_notes": "one line: pitch + best venue for the whole plant"
  }}
}}
Rate cuttings and whole-plant separately — they often differ. Output JSON only."""

# --- DIAGNOSE: health check from the photo (vision, on-demand) ---
DIAGNOSE_PROMPT = """A photo of a {common} ({species}) is attached. Diagnose how THIS individual
plant is actually doing from what you can SEE (leaf color, spots, webbing, pests, soil, wilting,
leggy growth) — not generic worries.

Return ONLY a JSON object (no markdown) with this exact shape:
{{
  "diagnosis": {{
    "status": "healthy | watch | issue",
    "summary": "one honest line on how the plant looks in THIS photo",
    "issues": [
      {{
        "condition": "name it (Root rot, Spider mites, Underwatered, Sunburn, Leggy/low light, ...)",
        "severity": "low | medium | high",
        "signs": "the SPECIFIC things visible in this photo that point to it",
        "action": "concrete fix steps the owner can do now — a real mini how-to",
        "home_remedy": "optional pantry/home fix if one genuinely applies",
        "learn_query": "short search phrase for a 'how to fix' link"
      }}
    ]
  }}
}}
RULES: if it looks healthy say so (status "healthy", reassuring summary, "issues": []). Only list
problems you can actually see; if ambiguous use "watch". Actions must be real horticulture (root rot:
unpot, trim mushy roots w/ sterilized blade, repot in fresh draining mix, water less; pests: alcohol
swab + insecticidal soap; etc.). Output JSON only."""


def _media_type(content_type: str | None) -> str:
    if content_type in _VISION_TYPES:
        return content_type
    return "image/jpeg"


def _parse(msg) -> dict:
    text = "".join(b.text for b in msg.content if b.type == "text")
    return json.loads(text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip())


async def enrich_core(species: str, common: str) -> PropResult:
    """Fast text-only pass: identity + care + propagation + edible (no pricing/diagnosis)."""
    msg = await client.messages.create(
        model=MODEL, max_tokens=2600,
        messages=[{"role": "user", "content": CORE_PROMPT.format(species=species, common=common)}],
    )
    return PropResult.model_validate(_parse(msg))


async def appraise_plant(species: str, common: str) -> dict:
    """On-demand resale pricing -> {marketability, established}."""
    msg = await client.messages.create(
        model=MODEL, max_tokens=700,
        messages=[{"role": "user", "content": APPRAISE_PROMPT.format(species=species, common=common)}],
    )
    return _parse(msg)


# --- EDIBLE: foraging / kitchen (text-only, on-demand) ---
EDIBLE_PROMPT = """Is a {common} ({species}) edible? Be conservative and safety-first.

Return ONLY a JSON object (no markdown) with this exact shape:
{{
  "edible": {{
    "status": "edible | parts_edible | not_edible | toxic",
    "score": 0-10 integer (how worthwhile/palatable to eat; 0 if not edible or toxic),
    "summary": "one honest line — what's edible, or why you shouldn't eat it",
    "edible_parts": "which parts are edible AND which to avoid (empty if none edible)",
    "forage": "the EASIEST beginner way + best season to find/harvest it (empty if not edible)",
    "prepare": "the EASIEST beginner way to prepare/eat it (empty if not edible)",
    "caution": "the real safety risks: toxic parts, poisonous LOOKALIKES, must-cook, raw toxicity, limits"
  }}
}}
Any toxic part -> status "toxic"/"parts_edible" with a clear warning (danger to kids/pets). If unsure
it's safely edible use "not_edible". ALWAYS fill "caution". Never imply a photo ID is enough to eat a
wild plant. Output JSON only."""


async def edible_plant(species: str, common: str) -> dict:
    """On-demand edibility / foraging info -> {edible}."""
    msg = await client.messages.create(
        model=MODEL, max_tokens=900,
        messages=[{"role": "user", "content": EDIBLE_PROMPT.format(species=species, common=common or species)}],
    )
    return _parse(msg)


DIAGRAM_PROMPT = """Return ONLY a JSON object: {{"diagram_svg": "<svg ...>"}}
where diagram_svg is a self-contained inline SVG (viewBox 0 0 200 200, no external refs, 2-3 colors,
simple clean line art) illustrating how to propagate a {common} ({species}) by {method}. Output JSON only."""


async def diagram_plant(species: str, common: str, method: str) -> dict:
    """On-demand propagation diagram (loaded in the background after the fast core result)."""
    msg = await client.messages.create(
        model=MODEL, max_tokens=1500,
        messages=[{"role": "user", "content": DIAGRAM_PROMPT.format(
            species=species, common=common or species, method=method or "cutting")}],
    )
    return _parse(msg)


async def diagnose_plant(species: str, common: str, image: bytes, content_type: str | None) -> dict:
    """On-demand vision health check -> {diagnosis}."""
    b64 = base64.standard_b64encode(image).decode()
    content = [
        {"type": "image", "source": {"type": "base64", "media_type": _media_type(content_type), "data": b64}},
        {"type": "text", "text": DIAGNOSE_PROMPT.format(species=species, common=common)},
    ]
    msg = await client.messages.create(
        model=MODEL, max_tokens=1500, messages=[{"role": "user", "content": content}],
    )
    return _parse(msg)


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
