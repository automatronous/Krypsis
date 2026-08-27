import { SmolVLMAdapter } from "../adapters/vision";
const adapter = new SmolVLMAdapter({
  modelBaseUrl: "",
  modelRevision: "",
  maxInputPixels: 1024 * 1024
});
self.onmessage = async (
  event: MessageEvent<{
    type: "initialize" | "analyze" | "dispose";
    image?: ImageData;
    instruction?: string;
  }>
) => {
  try {
    if (event.data.type === "initialize") {
      await adapter.initialize();
      self.postMessage({ type: "ready", available: adapter.isAvailable() });
    } else if (event.data.type === "analyze" && event.data.image) {
      self.postMessage({
        type: "result",
        result: await adapter.analyze(
          event.data.image,
          event.data.instruction ?? ""
        )
      });
    } else if (event.data.type === "dispose") {
      await adapter.dispose();
      self.postMessage({ type: "disposed" });
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      message:
        error instanceof Error ? error.message : "Vision worker failed safely."
    });
  }
};
