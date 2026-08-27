import { detectCapabilities } from "../../extension/src/perception/capabilities";
import type { Rect } from "../../extension/src/types/domain";
export interface VisionResult {
  label: string;
  confidence: number;
  target?: { label: string; x: number; y: number; confidence: number };
  backend: "WebGPU" | "WASM" | "NONE";
  latencyMs: number;
  available: boolean;
  reason?: string;
}
export interface VisionPerception {
  initialize(): Promise<void>;
  isAvailable(): boolean;
  analyze(image: ImageData | Blob, instruction: string): Promise<VisionResult>;
  dispose(): Promise<void>;
}
export interface VisionModelConfig {
  modelBaseUrl: string;
  modelRevision: string;
  maxInputPixels: number;
}
export class SmolVLMAdapter implements VisionPerception {
  private ready = false;
  private backend: VisionResult["backend"] = "NONE";
  private readonly config: VisionModelConfig;
  constructor(config: VisionModelConfig) {
    this.config = config;
  }
  async initialize(): Promise<void> {
    const capabilities = detectCapabilities();
    this.backend = capabilities.backend;
    this.ready = false;
    if (!capabilities.wasm) return;
    if (!this.config.modelBaseUrl || !this.config.modelRevision)
      return; /* Model assets are opt-in; setup:model records the exact approved revision. */
  }
  isAvailable(): boolean {
    return this.ready;
  }
  async analyze(
    _image: ImageData | Blob,
    _instruction: string
  ): Promise<VisionResult> {
    const started = performance.now();
    if (!this.ready)
      return {
        label: "unavailable",
        confidence: 0,
        backend: this.backend,
        latencyMs: performance.now() - started,
        available: false,
        reason: "Approved SmolVLM assets are not installed or initialized."
      };
    return {
      label: "unavailable",
      confidence: 0,
      backend: this.backend,
      latencyMs: performance.now() - started,
      available: false,
      reason: "Inference adapter requires verified model graph bindings."
    };
  }
  async dispose(): Promise<void> {
    this.ready = false;
    this.backend = "NONE";
  }
}
export function validateVisionTarget(
  target: { x: number; y: number; confidence: number },
  region: Rect
): boolean {
  return (
    target.confidence >= 0.8 &&
    target.x >= region.x &&
    target.y >= region.y &&
    target.x <= region.x + region.width &&
    target.y <= region.y + region.height
  );
}
