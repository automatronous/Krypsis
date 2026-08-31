/**
 * redactor.ts
 * Canvas-based visual PII redaction in a service worker context.
 * Uses OffscreenCanvas + ImageBitmap (both available in MV3 service workers).
 *
 * Redaction strategies:
 *   BLACKOUT  — solid black fill (password fields, credit-card inputs)
 *   BLUR      — heavy pixelation (faces, profile images)
 *   PIXELATE  — lighter pixelation (addresses, phone numbers in visible text)
 */

import type { PageContext, RedactionRegion } from "../types/domain";

/** Convert a data URL to an ImageBitmap without using the DOM. */
async function loadBitmap(dataUrl: string): Promise<ImageBitmap> {
  const resp = await fetch(dataUrl);
  const blob = await resp.blob();
  return createImageBitmap(blob);
}

/** Convert an OffscreenCanvas blob back to a base64 data URL (no FileReader). */
async function canvasToDataUrl(canvas: OffscreenCanvas): Promise<string> {
  const blob = await canvas.convertToBlob({ type: "image/png" });
  const buffer = await new Response(blob).arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

/** Apply pixelation to a region of the canvas (works for blur effect). */
function pixelate(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  blockSize: number
): void {
  if (w <= 0 || h <= 0) return;
  const tiny = new OffscreenCanvas(
    Math.max(1, Math.round(w / blockSize)),
    Math.max(1, Math.round(h / blockSize))
  );
  const tCtx = tiny.getContext("2d")!;
  tCtx.drawImage(ctx.canvas, x, y, w, h, 0, 0, tiny.width, tiny.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tiny, 0, 0, tiny.width, tiny.height, x, y, w, h);
  ctx.imageSmoothingEnabled = true;
}

/**
 * Deduplicate regions that cover substantially the same rectangle.
 */
export function deduplicateRegions(regions: RedactionRegion[]): RedactionRegion[] {
  const result: RedactionRegion[] = [];
  for (const r of regions) {
    const duplicate = result.some(
      (existing) =>
        Math.abs(existing.x - r.x) <= 5 &&
        Math.abs(existing.y - r.y) <= 5 &&
        Math.abs(existing.width - r.width) <= 10 &&
        Math.abs(existing.height - r.height) <= 10
    );
    if (!duplicate) {
      result.push(r);
    }
  }
  return result;
}

/**
 * Compute redaction regions from page context (DOM-based).
 * DPR scaling converts CSS pixel rects to physical screenshot pixel rects.
 */
export function computeRedactionRegions(context: PageContext): RedactionRegion[] {
  const dpr = context.devicePixelRatio || 1;
  const regions: RedactionRegion[] = [];

  for (const el of context.elements) {
    if (!el.visible) continue;
    const { x, y, width, height } = el.rect;
    if (width <= 0 || height <= 0) continue;

    // As requested: only blur images (img / picture), leave everything else unredacted
    if (el.tag === "img" || el.tag === "picture") {
      regions.push({
        x: Math.round(x * dpr),
        y: Math.round(y * dpr),
        width: Math.round(width * dpr),
        height: Math.round(height * dpr),
        redactionType: "BLUR",
        reason: "image media element"
      });
    }
  }

  return deduplicateRegions(regions);
}

/**
 * Apply all redaction regions to a screenshot.
 * Returns the redacted image as a data URL plus metadata.
 */
export async function redactScreenshot(
  screenshotDataUrl: string,
  regions: RedactionRegion[]
): Promise<{ dataUrl: string; appliedCount: number }> {
  const bitmap = await loadBitmap(screenshotDataUrl);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d")!;

  // Draw original screenshot
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  let appliedCount = 0;

  for (const region of regions) {
    const { x, y, width, height, redactionType } = region;
    if (width <= 0 || height <= 0) continue;

    switch (redactionType) {
      case "BLACKOUT":
        ctx.fillStyle = "#000000";
        ctx.fillRect(x, y, width, height);
        break;

      case "BLUR":
        // Heavy pixelation — looks like blur
        pixelate(ctx, x, y, width, height, 12);
        break;

      case "PIXELATE":
        // Lighter pixelation
        pixelate(ctx, x, y, width, height, 6);
        break;
    }

    appliedCount++;
  }

  // Draw semi-transparent red border around each redacted region for demo visibility
  ctx.strokeStyle = "rgba(255, 60, 60, 0.7)";
  ctx.lineWidth = 2;
  for (const r of regions) {
    if (r.width > 0 && r.height > 0) {
      ctx.strokeRect(r.x + 1, r.y + 1, r.width - 2, r.height - 2);
    }
  }

  const dataUrl = await canvasToDataUrl(canvas);
  return { dataUrl, appliedCount };
}
