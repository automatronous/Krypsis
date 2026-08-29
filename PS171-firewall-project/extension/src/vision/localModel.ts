import { pipeline, env } from "@huggingface/transformers";
import type { RedactionRegion } from "../types/domain";

// Tell Transformers.js not to look for local file paths in a browser environment
env.allowLocalModels = false;

interface DetectionBox {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

interface DetectionResult {
  label: string;
  score: number;
  box: DetectionBox;
}

class VisionPipeline {
  static task = "object-detection";
  // YOLOS is a Vision Transformer (ViT). Tiny version is ~30MB.
  static model = "Xenova/yolos-tiny";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static instance: any = null;

  static async getInstance() {
    if (this.instance === null) {
      console.log("Loading local vision model (YOLOS ViT)...");
      // @ts-expect-error Transformers.js pipeline dynamic typing
      this.instance = await pipeline(this.task, this.model, {
        device: "webgpu"
      });
    }
    return this.instance;
  }
}

export async function detectSensitiveRegionsML(
  imageDataUrl: string
): Promise<RedactionRegion[]> {
  try {
    const detector = await VisionPipeline.getInstance();

    // Run inference
    const results: DetectionResult[] = await detector(imageDataUrl, {
      threshold: 0.85
    });

    // COCO dataset labels to redact: 'person' (faces/avatars) or 'cell phone' (devices)
    const sensitiveLabels = ["person", "cell phone"];
    const filtered = results.filter((r) => sensitiveLabels.includes(r.label));

    return filtered.map((r) => {
      const width = Math.round(r.box.xmax - r.box.xmin);
      const height = Math.round(r.box.ymax - r.box.ymin);
      return {
        x: Math.round(r.box.xmin),
        y: Math.round(r.box.ymin),
        width,
        height,
        redactionType: "BLUR",
        reason: `ML Vision Transformer (YOLOS) detected ${r.label} (${Math.round(r.score * 100)}%)`
      };
    });
  } catch (err) {
    console.warn("Local ML detection skipped or failed:", err);
    return [];
  }
}
