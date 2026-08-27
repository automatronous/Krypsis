# PS171 Local Privacy & Safety Firewall

Lightweight on-device privacy and security layer for browser agents.

PS171 is a security wall, not a general browser agent. It collects bounded structured DOM context locally, treats page content as untrusted, detects sensitive data and prompt injection, emits minimum-necessary sanitized context, and governs proposed actions with deterministic `ALLOW`, `SANITIZE`, `CONFIRM`, or `BLOCK` decisions.

## Architecture

`content script → service worker → local detection/sanitization/policy → popup dashboard`

The normal perception route is DOM → deterministic rules → optional lightweight classifier → selective visual fallback. The `SmolVLMAdapter` boundary and worker are present, but real SmolVLM ONNX assets are intentionally not bundled or claimed as available until the exact official revision, processor, graph bindings, and checksums are verified. Missing model assets never bypass policy.

## Install and verify

Requires Node.js 20+, npm, and Chrome/Chromium.

```powershell
npm install --cache .npm-cache
npm run typecheck
npm test
npm run lint
npm run build
```

`npm run test:integration` builds first and runs the Playwright fixture/package checks. On this Windows host it uses the installed Chrome executable automatically; set `PS171_BROWSER_EXECUTABLE` to override it. The automated environment does not expose unpacked MV3 workers reliably, so verify the live extension manually as described below.

## Load the extension

1. Run `npm run build`.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Choose Load unpacked and select the absolute `dist/extension` directory.
5. Open `test-sites/basic/index.html` through `npm run serve:test-site`, then click the PS171 toolbar icon.

Useful fixtures are `/basic/`, `/malicious/`, and `/visual/`. The popup shows sensor counts, decision, evidence, backend readiness, and local-only status.

## Model setup and offline behavior

Run `npm run setup:model` to create a gated manifest. It does not download model files or invent filenames. Review the official Hugging Face model repository and record a pinned approved revision and SHA-256 checksums before adding assets. The extension continues with DOM and deterministic rules offline. WebGPU is detected at runtime; WASM is the broad fallback. `PS171_MOCK_AI=true` is reserved for a future explicit development-only mock path and must not be described as real vision.

## Add detectors and policy rules

Add deterministic patterns in `extension/src/security/pii.ts`, return typed `Detection` objects, and add regression tests in `tests/core.test.ts`. Add inspectable policy rules in `extension/src/policy/policy.ts`; ML evidence must remain advisory and cannot execute actions directly. Keep audit evidence free of raw secrets.

## Security assumptions and limitations

Page text, hidden content, reviews, and iframe metadata are untrusted. No detector is perfect and this project makes no 100% security or injection-detection claim. The MVP requests `<all_urls>` for the demonstration sensor; a store-ready release should narrow host matches and review permissions. The real multimodal model path remains gated pending verified model assets and graph-specific bindings.

See [docs/architecture.md](docs/architecture.md), [docs/threat-model.md](docs/threat-model.md), [docs/security.md](docs/security.md), [docs/model.md](docs/model.md), and [docs/judge-qa.md](docs/judge-qa.md).
