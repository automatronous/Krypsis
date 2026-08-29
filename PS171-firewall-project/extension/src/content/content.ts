import { collectPageContext } from "../browser/collector";
import { executeAction } from "../actions/executor";
import type { AgentAction, PageContext } from "../types/domain";

let mutationCount = 0;
let timer: number | undefined;
let contextInvalidated = false;

/** Check whether the extension runtime is still alive before calling any chrome API. */
function isRuntimeAlive(): boolean {
  try {
    // chrome.runtime.id becomes undefined when the extension context is invalidated
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

const report = async () => {
  if (contextInvalidated || !isRuntimeAlive()) return;
  try {
    const context: PageContext = collectPageContext();
    context.mutationCount = mutationCount;
    await chrome.runtime.sendMessage({ type: "PS171_CONTEXT", context });
  } catch (err: unknown) {
    // Silence "Extension context invalidated" — happens when extension reloads while tab is open
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("context invalidated") || msg.includes("Extension context")) {
      contextInvalidated = true;
      observer.disconnect(); // stop observing, this content script is a zombie
    }
  }
};

const observer = new MutationObserver(() => {
  if (contextInvalidated) return;
  mutationCount += 1;
  if (timer !== undefined) window.clearTimeout(timer);
  timer = window.setTimeout(() => void report(), 350);
});

observer.observe(document.documentElement, {
  subtree: true,
  childList: true,
  attributes: true,
  characterData: true
});

void report();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (contextInvalidated || !isRuntimeAlive()) return false;

  // Return current page context on demand
  if (message === "PS171_GET_CONTEXT") {
    sendResponse(collectPageContext());
    return false;
  }

  // Execute a single agent action (called by background after policy approval)
  if (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: string }).type === "PS171_EXECUTE_ACTION"
  ) {
    const { action, index } = message as { action: AgentAction; index: number };
    void executeAction(action, index).then(sendResponse);
    return true; // async response
  }

  return false;
});
