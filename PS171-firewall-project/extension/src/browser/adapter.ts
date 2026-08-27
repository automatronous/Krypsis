export interface BrowserAdapter {
  readonly name: "Chrome/Chromium" | "Firefox";
  supportsWebGPU(): boolean;
  sendMessage<T>(message: unknown): Promise<T>;
}
export class WebExtensionAdapter implements BrowserAdapter {
  readonly name: "Chrome/Chromium" | "Firefox" =
    typeof browser !== "undefined" ? "Firefox" : "Chrome/Chromium";
  supportsWebGPU(): boolean {
    return typeof navigator !== "undefined" && "gpu" in navigator;
  }
  async sendMessage<T>(message: unknown): Promise<T> {
    return chrome.runtime.sendMessage(message) as Promise<T>;
  }
}
