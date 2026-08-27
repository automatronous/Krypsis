import { collectPageContext } from "../browser/collector";
import type { PageContext } from "../types/domain";
let mutationCount = 0;
let timer: number | undefined;
const report = async () => {
  const context: PageContext = collectPageContext();
  context.mutationCount = mutationCount;
  await chrome.runtime.sendMessage({ type: "PS171_CONTEXT", context });
};
const observer = new MutationObserver(() => {
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
  if (message === "PS171_GET_CONTEXT") {
    sendResponse(collectPageContext());
    return false;
  }
  return false;
});
