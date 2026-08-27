import type { PageContext, PolicyResult } from "../types/domain";
function metric(label: string, value: string | number): string {
  return `<div class="metric"><b>${String(value)}</b><small>${label}</small></div>`;
}
function safe(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] ?? char
  );
}
async function render(): Promise<void> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) return;
  const status = (await chrome.tabs.sendMessage(
    tab.id,
    "PS171_GET_CONTEXT"
  )) as PageContext;
  const response = (await chrome.runtime.sendMessage({
    type: "PS171_GET_STATUS",
    tabId: tab.id
  })) as { context?: PageContext; policy?: PolicyResult };
  const context = response.context ?? status;
  const policy =
    response.policy ??
    ({
      decision: "ALLOW",
      reasons: ["No status yet."],
      evidence: [],
      risk: 0
    } as PolicyResult);
  const state = document.querySelector<HTMLElement>("#state");
  if (state) {
    state.textContent =
      policy.decision === "ALLOW" ? "PROTECTED" : policy.decision;
    state.style.color =
      policy.decision === "BLOCK"
        ? "#ff8590"
        : policy.decision === "CONFIRM"
          ? "#ffd37a"
          : "#78d6b0";
  }
  document.querySelector("#sensor")!.innerHTML = [
    metric("visible characters", context.pageText.length),
    metric("forms", context.forms.length),
    metric(
      "password fields",
      context.elements.filter((e) => e.type === "password").length
    ),
    metric(
      "buttons",
      context.elements.filter((e) => e.tag === "button").length
    ),
    metric("links", context.elements.filter((e) => e.tag === "a").length),
    metric("iframes", context.iframes.length),
    metric("mutations", context.mutationCount),
    metric(
      "sensitive elements",
      context.elements.filter((e) => e.sensitive).length
    )
  ].join("");
  document.querySelector("#decision")!.innerHTML =
    `<div class="decision">${safe(policy.decision)}</div><div class="reason">${safe(policy.reasons.join(" "))}</div>`;
  document.querySelector("#evidence")!.innerHTML = policy.evidence.length
    ? policy.evidence
        .map(
          (item) =>
            `<div><b>${safe(item.rule)}</b> — ${safe(item.detail)}</div>`
        )
        .join("")
    : "No restriction evidence.";
  document.querySelector("#performance")!.innerHTML = [
    metric("last inference", "DOM + rules"),
    metric("backend", "WASM fallback ready"),
    metric("model", "not loaded"),
    metric("network", "local only")
  ].join("");
}
void render().catch((error: unknown) => {
  const node = document.querySelector("#decision");
  if (node)
    node.textContent =
      error instanceof Error
        ? error.message
        : "Unable to read local page status.";
});
