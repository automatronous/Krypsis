export type ComputeTier = "HIGH" | "MEDIUM" | "LOW";
export interface RuntimeCapabilities {
  webgpu: boolean;
  wasm: boolean;
  tier: ComputeTier;
  backend: "WebGPU" | "WASM" | "NONE";
}
export function detectCapabilities(): RuntimeCapabilities {
  const webgpu = typeof navigator !== "undefined" && "gpu" in navigator;
  const wasm = typeof WebAssembly !== "undefined";
  const memory =
    typeof navigator !== "undefined" && "deviceMemory" in navigator
      ? Number(
          (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4
        )
      : 4;
  const tier: ComputeTier =
    memory >= 8 ? "HIGH" : memory >= 4 ? "MEDIUM" : "LOW";
  return {
    webgpu,
    wasm,
    tier,
    backend: webgpu ? "WebGPU" : wasm ? "WASM" : "NONE"
  };
}
