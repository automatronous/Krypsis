/**
 * ocr.ts
 * Client-side Optical Character Recognition (OCR) using EasyOCR ONNX model.
 * Extracts visible text from screenshots for:
 *   1. Local redaction: detect readable PII like addresses, emails in visible text
 *   2. Server context: sanitized OCR text enriches VLM understanding of page semantics
 *
 * Strategy: Lazy-load model on first use, cache results per screenshot.
 */

import { pipeline, env } from "@huggingface/transformers";
import type { TextRegion, OCRResult } from "../types/domain";

// Prevent Transformers.js from searching for local model paths in browser
env.allowLocalModels = false;

interface OCRBox {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

interface OCRDetection {
  text: string;
  score: number;
  box: OCRBox;
}

class OCRPipeline {
  static task = "document-question-answering"; // or "ocr" if available
  // Lightweight ONNX-compatible OCR model. Adjust based on availability.
  // PaddleOCR or EasyOCR ONNX exports are ~50MB total.
  static model = "Xenova/ocr_base"; // placeholder; see ml/models/model-manifest.json for actual model
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static instance: any = null;
  static lastScreenshotHash: string | null = null;
  static cachedResults: OCRResult | null = null;

  static async getInstance() {
    if (this.instance === null) {
      console.log("Loading OCR model (EasyOCR ONNX)...");
      try {
        // @ts-expect-error Transformers.js pipeline dynamic typing
        this.instance = await pipeline(this.task, this.model, {
          device: "webgpu"
        });
      } catch (err) {
        console.warn("OCR model load failed, falling back to unavailable:", err);
        this.instance = "unavailable";
      }
    }
    return this.instance;
  }

  static clearCache() {
    this.lastScreenshotHash = null;
    this.cachedResults = null;
  }
}

/**
 * Compute a simple hash of a data URL for caching OCR results.
 * Avoids re-running expensive OCR on identical screenshots.
 */
function hashScreenshot(dataUrl: string): string {
  let hash = 0;
  const str = dataUrl.slice(0, 500); // hash first 500 chars (header + start of b64)
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

/**
 * Extract readable text regions from a screenshot using OCR.
 * Returns bounding boxes + text content + confidence scores.
 *
 * This runs lazily (first call only) and caches results per unique screenshot.
 */
export async function extractTextRegions(
  imageDataUrl: string
): Promise<TextRegion[]> {
  try {
    const ocr = await OCRPipeline.getInstance();

    // If model unavailable, skip OCR
    if (ocr === "unavailable") {
      console.debug("OCR model not available, skipping text extraction");
      return [];
    }

    // Check cache: if screenshot hash matches, return cached results
    const hash = hashScreenshot(imageDataUrl);
    if (
      OCRPipeline.lastScreenshotHash === hash &&
      OCRPipeline.cachedResults
    ) {
      console.debug("Returning cached OCR results");
      return OCRPipeline.cachedResults.regions;
    }

    console.log("Running OCR inference...");
    const startTime = performance.now();

    // Run OCR inference
    // Note: Exact API depends on the model chosen. Adjust based on Transformers.js pipeline output.
    const results: OCRDetection[] = await ocr(imageDataUrl, {
      threshold: 0.3 // Lower threshold to catch more text; we'll filter by readability
    });

    const elapsed = performance.now() - startTime;
    console.log(`OCR completed in ${elapsed.toFixed(0)}ms`);

    // Convert to TextRegion format
    const regions: TextRegion[] = results
      .filter((r) => r.text && r.text.trim().length > 0)
      .map((r) => {
        const width = Math.round(r.box.xmax - r.box.xmin);
        const height = Math.round(r.box.ymax - r.box.ymin);
        const isReadable = r.score > 0.6 && width > 20 && height > 15; // Heuristic for legibility

        return {
          x: Math.round(r.box.xmin),
          y: Math.round(r.box.ymin),
          width,
          height,
          text: r.text.trim(),
          confidence: r.score,
          isReadable
        };
      });

    // Cache results
    const cacheEntry: OCRResult = {
      regions,
      confidence: regions.length > 0 && regions[0] ? regions[0].confidence : 0,
      extractedAt: Date.now()
    };
    OCRPipeline.lastScreenshotHash = hash;
    OCRPipeline.cachedResults = cacheEntry;

    return regions;
  } catch (err) {
    console.warn("OCR extraction failed:", err);
    return [];
  }
}

/**
 * Extract text content from OCR regions for sanitization purposes.
 * Returns array of text + confidence pairs (used for PII detection on visible text).
 */
export function getOCRTextContent(regions: TextRegion[]): Array<{ text: string; confidence: number }> {
  return regions
    .filter((r) => r.isReadable)
    .map((r) => ({
      text: r.text,
      confidence: r.confidence
    }));
}

/**
 * Merge OCR-detected text regions with existing redaction regions.
 * If OCR finds readable PII in visible text, mark region for redaction.
 */
export function mergeOCRRedactions(
  existingRegions: Array<{ x: number; y: number; width: number; height: number; redactionType: string; reason: string }>,
  ocrRegions: TextRegion[],
  piiDetector: (text: string) => boolean
): Array<{ x: number; y: number; width: number; height: number; redactionType: string; reason: string }> {
  const merged = [...existingRegions];

  for (const region of ocrRegions) {
    if (piiDetector(region.text)) {
      // Check if this region is already covered by an existing redaction
      const alreadyCovered = merged.some(
        (existing) =>
          existing.x <= region.x &&
          existing.x + existing.width >= region.x + region.width &&
          existing.y <= region.y &&
          existing.y + existing.height >= region.y + region.height
      );

      if (!alreadyCovered) {
        merged.push({
          x: region.x,
          y: region.y,
          width: region.width,
          height: region.height,
          redactionType: "PIXELATE", // Text PII → lighter pixelation (not black)
          reason: `OCR detected PII text: "${region.text.slice(0, 30)}..."`
        });
      }
    }
  }

  return merged;
}

/**
 * Clear OCR cache (useful between screenshots or for testing).
 */
export function clearOCRCache() {
  OCRPipeline.clearCache();
}
