import { pipeline, env } from "@huggingface/transformers";
import type { RedactionRegion } from "../types/domain";

// Tell Transformers.js not to look for local file paths in a browser environment
env.allowLocalModels = false;

interface FaceBox {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

interface FaceDetectionResult {
  score: number;
  box: FaceBox;
}

class VisionPipeline {
  static task = "object-detection";
  // BlazeFace: Lightweight face detector from MediaPipe, ~1-2MB ONNX.
  // More accurate for faces than YOLOS, faster inference.
  static model = "Xenova/blazeface-128";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static instance: any = null;

  static async getInstance() {
    if (this.instance === null) {
      console.log("Loading face detection model (BlazeFace)...");
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
    const results: FaceDetectionResult[] = await detector(imageDataUrl, {
      threshold: 0.5 // BlazeFace optimal threshold: lower than YOLOS, catches more faces
    });

    // BlazeFace detects faces only (no label, just coordinates + confidence)
    // Convert to redaction regions with BLUR strategy
    return results.map((r) => {
      const width = Math.round(r.box.xmax - r.box.xmin);
      const height = Math.round(r.box.ymax - r.box.ymin);
      return {
        x: Math.round(r.box.xmin),
        y: Math.round(r.box.ymin),
        width,
        height,
        redactionType: "BLUR",
        reason: `BlazeFace detected face (${Math.round(r.score * 100)}% confidence)`
      };
    });
  } catch (err) {
    console.warn("Local face detection skipped or failed:", err);
    return [];
  }
}
