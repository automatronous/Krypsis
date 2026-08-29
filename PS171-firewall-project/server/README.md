# PS171 Privacy Vision Agent — Server

Receives privacy-redacted screenshots from the browser extension, processes them via **Gemini 1.5 Flash** (multimodal), and returns structured browser automation commands.

## Setup

```bash
cd server
cp .env.example .env
# Edit .env and add your Gemini API key
npm install
npm start
```

## Get a Gemini API Key

1. Go to [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Create a free API key
3. Paste it into `.env` as `GEMINI_API_KEY=...`

> **Free tier** — 15 requests/minute, 1M tokens/day. More than enough for demos.

## Endpoints

### `GET /health`
Returns `{ "status": "ok" }` to confirm the server is running.

### `POST /analyze`

| Field | Type | Required | Description |
|---|---|---|---|
| `screenshot_b64` | string | ✅ | Base64-encoded PNG of the **redacted** screenshot |
| `task_goal` | string | ✅ | Natural language instruction ("Click the checkout button") |
| `dom_summary` | object | ✓ | Sanitized DOM context from the extension |
| `redacted_regions` | array | ✓ | List of redacted bounding boxes with reasons |
| `page_url` | string | ✓ | Current page URL |

**Response:**
```json
{
  "actions": [
    { "type": "CLICK", "selector": "#checkout-btn", "label": "Checkout button", "confidence": 0.95 },
    { "type": "SCROLL", "scrollY": 300, "label": "Scroll to payment section", "confidence": 0.80 }
  ],
  "summary": "Found the checkout button below the cart summary.",
  "requires_confirmation": false,
  "latency_ms": 643
}
```

## Action Types

| Type | Required fields | Description |
|---|---|---|
| `CLICK` | `selector` | Click an element |
| `TYPE` | `selector`, `value` | Type text into a field |
| `SCROLL` | `scrollY` | Scroll by pixels |
| `NAVIGATE` | `url` | Go to a URL |
| `SUBMIT` | `selector` | Submit a form |

## Privacy Design

The server **never receives** raw sensitive data. The extension's redactor:
- **Blacks out** password fields and financial inputs
- **Pixelates** faces and profile images  
- **Sends only** the anonymized screenshot + structural DOM metadata

The Gemini prompt explicitly tells the model that redacted regions exist and instructs it not to reference or recover their content.
