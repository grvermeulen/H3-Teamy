import os
import io
from typing import Optional

import numpy as np
import cv2  # type: ignore
from fastapi import FastAPI, File, UploadFile, Header, HTTPException
from fastapi.responses import JSONResponse


APP_TOKEN_ENV = "WORKER_TOKEN"

app = FastAPI(title="H3-Teamy OCR Worker", version="1.0.0")

_reader = None


def _init_reader():
    global _reader
    if _reader is not None:
        return _reader
    # Lazy import to speed cold start path
    import easyocr  # type: ignore

    languages = ["nl", "en"]
    _reader = easyocr.Reader(languages, gpu=False)
    return _reader


def _require_auth(authorization: Optional[str]):
    token = os.getenv(APP_TOKEN_ENV, "").strip()
    if not token:
        # Misconfiguration; fail closed
        raise HTTPException(status_code=500, detail="worker_token_missing")
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing_bearer_token")
    provided = authorization.split(" ", 1)[1].strip()
    if provided != token:
        raise HTTPException(status_code=403, detail="invalid_token")


@app.get("/health")
def health() -> JSONResponse:
    try:
        r = _init_reader()
        return JSONResponse({"ok": True, "reader": bool(r is not None)})
    except Exception as e:
        # Ensure errors are visible in logs and health
        print("[health:init_error]", str(e))
        raise HTTPException(status_code=500, detail=f"init_failed: {e}")


@app.post("/ocr")
async def ocr(
    image: UploadFile = File(...),
    authorization: Optional[str] = Header(default=None, convert_underscores=False),
):
    _require_auth(authorization)

    # Read file into a numpy image (BGR for OpenCV)
    data = await image.read()
    npbuf = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(npbuf, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="invalid_image")

    reader = _init_reader()
    # detail=0 returns only text strings, paragraph=False to avoid over-merge
    # Allow a balanced decode for scoreboard-like screenshots
    lines = reader.readtext(img, detail=0, paragraph=False)
    raw_text = "\n".join([str(x) for x in lines if isinstance(x, str)])

    # Keep normalization in the app for now (Option A). Return empty result placeholder.
    return JSONResponse({"raw_text": raw_text, "result": None})


