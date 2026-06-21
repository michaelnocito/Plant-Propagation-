import os

import httpx

ENDPOINT = "https://my-api.plantnet.org/v2/identify/all"


class IDError(Exception):
    pass


async def identify(image: bytes, media_type: str) -> tuple[str, str, float]:
    """Return (scientific_name, common_name, confidence 0-1)."""
    key = os.environ["PLANTNET_API_KEY"]
    files = {"images": ("plant.jpg", image, media_type)}
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(ENDPOINT, params={"api-key": key}, data={"organs": "auto"}, files=files)
    if r.status_code == 404:
        raise IDError("No plant recognized — try a clearer, closer shot.")
    r.raise_for_status()
    results = r.json().get("results") or []
    if not results:
        raise IDError("No confident match.")
    top = results[0]
    sp = top["species"]
    common = (sp.get("commonNames") or [sp["scientificNameWithoutAuthor"]])[0]
    return sp["scientificNameWithoutAuthor"], common, top["score"]
