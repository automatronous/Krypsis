# Local model status

The integration boundary is `SmolVLMAdapter`. It is deliberately not marked available until the exact approved ONNX assets, processor/tokenizer requirements, graph inputs/outputs, revision, and SHA-256 checksums have been verified. `npm run setup:model` creates a gated manifest but does not invent filenames or download unverified binaries.

ONNX Runtime Web is intended to use WebGPU when the browser exposes it and WASM as the compatibility path. A missing or failing model cannot bypass policy; the extension continues with DOM/rules and can require confirmation or block on uncertainty.

## Model Strategy (BlazeFace + EasyOCR)

### Why Replace YOLOS?

**YOLOS** (Vision Transformer, 30MB):
- General-purpose object detection (COCO labels)
- Detected "person" (faces) + "cell phone" (devices)
- Slower inference (~200ms per screenshot)

**BlazeFace** (2MB ONNX):
- Purpose-built face detector from MediaPipe
- ~10x smaller model footprint
- ~4x faster inference (~50ms)
- Higher accuracy for face detection specifically
- Trade-off: No device/object detection (acceptable if cell phone detection is lower priority)

**EasyOCR** (50MB ONNX):
- Extract visible text regions from screenshots
- Dual purpose:
  1. **Local**: Detect readable PII in visible text (emails, addresses, phone numbers not covered by DOM heuristics)
  2. **Server**: Send sanitized text to VLM, improving action planning context
- Complements DOM heuristics (which are fast but limited to structured form fields)

### Performance Targets

- **BlazeFace**: < 100ms per frame
- **EasyOCR**: < 500ms per full page (lazy-loaded, cached per screenshot hash)
- **Total pipeline**: < 2 seconds (capture + detect + redact + transmit)

### Model Availability

| Model | Size | Status | Backend | Purpose |
|-------|------|--------|---------|---------|
| BlazeFace | 2 MB | AVAILABLE | WebGPU/WASM | Client-side face detection |
| EasyOCR | 50 MB | PLACEHOLDER | WebGPU/WASM | Client-side text extraction |
| SmolVLM-256M | 500 MB | NOT_INSTALLED | Node.js (server) | Server-side action planning |
| OpenRouter Fallback | Cloud | CONFIGURED | HTTPS API | Cloud VLM backup |

### Security & Gating

- **BlazeFace**: Auto-loaded via Transformers.js (verified ONNX model)
- **EasyOCR**: Marked PLACEHOLDER pending ONNX compatibility verification with Transformers.js
- **SmolVLM**: Requires manual pinning of SHA-256 checksums (no auto-download)
- **Model manifest**: `ml/models/model-manifest.json` documents all models, sizes, and status

### Fallback Strategy

If client-side models fail or are unavailable:
1. Continue with DOM heuristics (always works)
2. Fall back to server-only processing (screenshot + DOM summary, no OCR context)
3. Server VLM can still plan actions with visual + structural context
4. Policy gating remains active; nothing bypasses approval

## Future Considerations

1. **Multi-language OCR**: Start with English; add other languages incrementally if needed
2. **Device detection**: If cell phone detection becomes critical, consider:
   - Option A: Keep small YOLOS alongside BlazeFace (hybrid approach)
   - Option B: Infer device presence from OCR text (e.g., detect "mobile app" phrases)
   - Option C: Accept simplified detection (faces + text only)
3. **Model quantization**: Further optimize BlazeFace/EasyOCR via dynamic quantization if latency requirements tighten
4. **Cache strategy**: Implement screenshot-hash-based caching for OCR results to avoid re-running expensive inference

