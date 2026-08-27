# Local model status

The integration boundary is `SmolVLMAdapter`. It is deliberately not marked available until the exact approved ONNX assets, processor/tokenizer requirements, graph inputs/outputs, revision, and SHA-256 checksums have been verified. `npm run setup:model` creates a gated manifest but does not invent filenames or download unverified binaries.

ONNX Runtime Web is intended to use WebGPU when the browser exposes it and WASM as the compatibility path. A missing or failing model cannot bypass policy; the extension continues with DOM/rules and can require confirmation or block on uncertainty.
