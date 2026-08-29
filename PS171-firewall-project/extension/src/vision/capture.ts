/**
 * capture.ts
 * Captures the currently visible tab as a PNG data URL.
 * Runs in the background service worker context.
 */

/** Capture the visible area of the active tab as a base64 PNG data URL. */
export async function captureActiveTab(): Promise<string> {
  return chrome.tabs.captureVisibleTab(null, { format: "png", quality: 90 });
}

/**
 * Convert a data URL to an ArrayBuffer (service-worker compatible — no FileReader).
 */
export async function dataUrlToArrayBuffer(dataUrl: string): Promise<ArrayBuffer> {
  const response = await fetch(dataUrl);
  return response.arrayBuffer();
}

/**
 * Convert an ArrayBuffer to a base64 string without stack overflow
 * (chunked to avoid exceeding call-stack limits on large images).
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
