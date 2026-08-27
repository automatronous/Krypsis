# Browser support

The extension uses Manifest V3-compatible content scripts, runtime messaging, service-worker background logic, and browser-neutral types. Chromium is the primary target. Firefox is supported by the adapter boundary where APIs match. WebAssembly is the broad fallback; WebGPU is detected at runtime and is not assumed to exist or behave identically across browsers.
