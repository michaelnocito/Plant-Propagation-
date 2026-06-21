from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .claude import enrich
from .plantid import IDError, identify

app = FastAPI(title="Rootwork")
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


@app.get("/")
async def index():
    return FileResponse(STATIC / "index.html")


app.mount("/", StaticFiles(directory=STATIC), name="static")
