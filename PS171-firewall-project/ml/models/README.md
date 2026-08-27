# Approved local model assets

This directory intentionally contains no model binaries. The browser path must use the approved `HuggingFaceTB/SmolVLM-500M-Instruct` ONNX assets at a pinned revision, with checksums recorded by `npm run setup:model`. Do not hand-copy or silently substitute another model. The current MVP continues to operate with DOM/rules/WASM capability detection when assets are absent.
