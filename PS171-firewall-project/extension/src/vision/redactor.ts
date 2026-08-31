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

    const textStr = (el.text ?? "").trim();
    const valStr = (el.value ?? "").trim();
    const combinedText = [textStr, valStr].filter(Boolean).join(" ");
    const fieldDescriptor = [
      el.name,
      el.placeholder,
      el.ariaLabel,
      el.type,
      el.id,
      el.attributes?.class,
      el.attributes?.autocomplete
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    // 1. Password / sensitive controls / secret values → BLACKOUT
    const isPasswordType = el.type === "password";
    const isPasswordDescriptor = /password|passcode|cvv|cvc|pin|secret|token|api[_-]?key/i.test(fieldDescriptor);
    const isPasswordText = /^(?:\*+|•+|password\s*:\s*\*+)$/i.test(combinedText);

    if (isPasswordType || el.sensitive || isPasswordDescriptor || isPasswordText) {
      regions.push({
        x: Math.round(x * dpr),
        y: Math.round(y * dpr),
        width: Math.round(width * dpr),
        height: Math.round(height * dpr),
        redactionType: "BLACKOUT",
        reason: "password or sensitive control"
      });
      continue;
    }

    // 2. Email addresses → PIXELATE
    const hasEmailRegex = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(combinedText);
    const isEmailField = el.type === "email" || /\b(?:email|e-mail|mail)\b/i.test(fieldDescriptor);

    if (hasEmailRegex || isEmailField) {
      regions.push({
        x: Math.round(x * dpr),
        y: Math.round(y * dpr),
        width: Math.round(width * dpr),
        height: Math.round(height * dpr),
        redactionType: "PIXELATE",
        reason: "email address or field"
      });
      continue;
    }

    // 3. Phone numbers → PIXELATE
    const digitsOnly = combinedText.replace(/\D/g, "");
    const hasPhoneRegex =
      /(?<!\d)(?:\+?\d{1,3}[ -]?)?\(?\d{2,4}\)?[ -]?\d{3,4}[ -]?\d{3,4}(?!\d)/.test(combinedText) &&
      digitsOnly.length >= 7 &&
      digitsOnly.length <= 15;
    const isPhoneField = el.type === "tel" || /\b(?:phone|mobile|telephone|cell|contact[-_]?no)\b/i.test(fieldDescriptor);

    if (hasPhoneRegex || isPhoneField) {
      regions.push({
        x: Math.round(x * dpr),
        y: Math.round(y * dpr),
        width: Math.round(width * dpr),
        height: Math.round(height * dpr),
        redactionType: "PIXELATE",
        reason: "phone number or field"
      });
      continue;
    }

    // 4. Person Names / User Identity → PIXELATE
    // Examples: "Nigel Fernandes", "Hello, Nigel", "Deliver to Nigel", "Name: Nigel Fernandes"
    const isNameFieldDescriptor = /\b(?:first[-_\s]?name|last[-_\s]?name|full[-_\s]?name|given[-_\s]?name|surname|family[-_\s]?name|middle[-_\s]?name|username|user[-_\s]?name|display[-_\s]?name|nickname|handle|profile[-_]?name|account[-_]?name)\b/i.test(
      fieldDescriptor
    );

    const hasNamePrefix = /^(?:name\s*:|full\s*name\s*:|first\s*name\s*:|last\s*name\s*:|hello\s*,|hi\s*,|deliver\s+to\s+|account\s*holder\s*:)\s*([A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+)*)/i.test(
      combinedText
    );

    const isCapitalizedFullName = /^[A-Z][a-zA-Z'.-]{1,20}(?:\s+[A-Z][a-zA-Z'.-]{1,20}){1,2}$/.test(textStr);

    const isUserIdentityContext = /\b(?:name|user|profile|author|account|login|nav-line|customer|byline)\b/i.test(
      fieldDescriptor + " " + (el.id ?? "")
    );

    if (
      isNameFieldDescriptor ||
      hasNamePrefix ||
      (isUserIdentityContext && isCapitalizedFullName)
    ) {
      regions.push({
        x: Math.round(x * dpr),
        y: Math.round(y * dpr),
        width: Math.round(width * dpr),
        height: Math.round(height * dpr),
        redactionType: "PIXELATE",
        reason: `person name or identity element (${textStr || "field"})`
      });
      continue;
    }

    // 5. Credit Card / Account Number / SSN / Financial / Address → PIXELATE
    const hasSsnRegex = /\b\d{3}-\d{2}-\d{4}\b/.test(combinedText);
    const isFinancialField = /\b(?:creditcard|cc-number|card|iban|routing|account|acct|ssn|social-security|address|street|postcode|zipcode)\b/i.test(
      fieldDescriptor
    );

    if (hasSsnRegex || isFinancialField) {
      regions.push({
        x: Math.round(x * dpr),
        y: Math.round(y * dpr),
        width: Math.round(width * dpr),
        height: Math.round(height * dpr),
        redactionType: "PIXELATE",
        reason: "financial/SSN/address field"
      });
      continue;
    }

    // 6. Content Images / Media → BLUR
    if ((el.tag === "img" || el.tag === "picture") && width >= 20 && height >= 20) {
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
