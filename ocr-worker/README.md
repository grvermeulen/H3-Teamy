# H3-Teamy OCR Worker (EasyOCR)

A minimal FastAPI service using EasyOCR to extract text from match screenshots.

## Endpoints
- POST `/ocr` (multipart/form-data)
  - field: `image` (image/*)
  - auth: `Authorization: Bearer <WORKER_TOKEN>`
  - response: `{ raw_text: string, result: null }` (normalization is done in the Next.js app)
- GET `/health`

## Environment
- `WORKER_TOKEN`: shared secret for bearer auth.

## Run locally
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

## Deploy
- Deploy as a separate service (e.g., Vercel, Railway). Ensure `WORKER_TOKEN` is configured.
- In the Next.js app, set:
  - `OCR_WORKER_URL`
  - `OCR_WORKER_TOKEN`


