# PS171 architecture

PS171 is a local-first firewall between browser context and an agent. The content script collects a bounded, structured `PageContext`; the service worker evaluates untrusted page text, sanitizes context, and logs decisions. Proposed actions use a typed taxonomy and are evaluated by the same deterministic policy engine before any executor is allowed to run.

The normal route is DOM → deterministic rules → BlazeFace face detection + EasyOCR text extraction → visual redaction → policy → allow/sanitize/confirm/block. Raw HTML, password values, unredacted screenshots, and unsanitized page text are not transmitted.

## Vision Pipeline (7 Stages)

```
┌─────────────────────┐
│  1. Capture         │ → Screenshot from active tab
└──────────┬──────────┘
           ↓
┌─────────────────────┐
│  2. Detect (DOM)    │ → Heuristic PII patterns on form fields
└──────────┬──────────┘
           ↓
┌─────────────────────────────┐
│  2b. Detect (BlazeFace)     │ → Lightweight face detection (~2MB ONNX)
└──────────┬──────────────────┘
           ↓
┌─────────────────────────────┐
│  2c. Extract Text (OCR)     │ → EasyOCR text regions for context + local PII detection
└──────────┬──────────────────┘
           ↓
┌─────────────────────┐
│  3. Redact          │ → Canvas: BLACKOUT (passwords), PIXELATE (text PII), BLUR (faces/images)
└──────────┬──────────┘
           ↓
┌─────────────────────────────────────┐
│  4. Transmit                        │ → POST redacted image + DOM summary + sanitized OCR text
│                                     │    to local server VLM
└──────────┬──────────────────────────┘
           ↓
┌─────────────────────┐
│  5. Plan (VLM)      │ → SmolVLM (local) or OpenRouter cloud: generate browser actions
└──────────┬──────────┘
           ↓
┌─────────────────────┐
│  6. Policy Gate     │ → Evaluate each action through PS171 policy engine
└──────────┬──────────┘
           ↓
┌─────────────────────┐
│  7. Return          │ → Approved actions + redacted screenshot to popup
└─────────────────────┘
```

## Models & Inference

### Client-Side (Browser Service Worker)
- **BlazeFace** (~2MB ONNX): Face detection from MediaPipe. Replaces YOLOS for faster, more accurate face detection.
  - Threshold: 0.5 (optimized for BlazeFace)
  - Backend: WebGPU (with WASM fallback)
  - Runtime: ~50ms per frame

- **EasyOCR** (~50MB ONNX): Text region extraction for:
  1. **Local redaction**: Detect readable PII in visible text (emails, addresses, phone numbers)
  2. **Server context**: Sanitized text enriches VLM understanding of page structure and semantics

### Server-Side (Node.js)
- **SmolVLM-256M-Instruct** (local, quantized to Q4): Primary vision language model
- **OpenRouter Cloud Fallback**: Gemini, Llama 3.2 Vision, Qwen (if local model unavailable)

## Redaction Strategies

1. **BLACKOUT**: Solid black fill
   - Applied to: Password fields, credit card inputs, auth tokens (highest sensitivity)

2. **PIXELATE**: Moderate pixelation (blockSize=6)
   - Applied to: Text-based PII detected via DOM heuristics or OCR (email, phone, address, DOB, SSN)

3. **BLUR**: Heavy pixelation (blockSize=12)
   - Applied to: Faces detected by BlazeFace, images, profile pictures, visual artifacts

## Privacy Guarantees

- **No unredacted data transmission**: Screenshots are fully redacted before leaving the browser
- **OCR text sanitization**: Visible text extracted by OCR is sanitized (PII masked) before server transmission
- **DOM-first heuristics**: Fast, deterministic redaction via element metadata (no ML latency)
- **ML as supplement**: BlazeFace + OCR enhance DOM detection but don't replace it
- **Audit trail**: Every detection, redaction, and policy decision is logged with evidence

## Key Files

- **Vision Pipeline**: `extension/src/vision/pipeline.ts`
- **Face Detection**: `extension/src/vision/localModel.ts` (BlazeFace)
- **Text Extraction**: `extension/src/vision/ocr.ts` (EasyOCR)
- **Visual Redaction**: `extension/src/vision/redactor.ts`
- **Server VLM**: `server/server.js`
- **Models**: `ml/models/model-manifest.json`

