# Facebook posts + dates (Playwright)

Apify actor that extracts either full post details (author, text, reactions, comments, shares, date) **or** just post dates from a list of Facebook post URLs. Uses Playwright and has an optional OCR fallback via Tesseract.

## Quick start (local)
```bash
npm ci
npm test     # runs three date parsing test files
npm start    # runs the actor (expects INPUT.json in Apify storage or input via platform)
```

## Deploy to Apify
- Ensure you have the **Apify CLI** and are logged in.
- This project includes `actor.json`, `Dockerfile`, and `input_schema.json` compatible with `apify push`.

```bash
apify login         # one-time
apify push          # builds & pushes the actor from this folder
```

## Run on Apify
Supply JSON input like:
```json
{
  "mode": "POST_DATES",
  "urls": ["https://www.facebook.com/..."],
  "enableOcr": false,
  "timezoneId": "Asia/Manila",
  "locale": "en-US",
  "headless": true
}
```
