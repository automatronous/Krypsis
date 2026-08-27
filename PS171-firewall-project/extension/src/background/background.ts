import { assessPageInjection } from "../security/injection";
import { evaluatePolicy } from "../policy/policy";
import { sanitizeContext } from "../sanitizer/sanitizer";
import { audit, getAuditEvents } from "../security/audit";
import type {
  BrowserAction,
  PageContext,
  PolicyResult,
  UserPolicy
} from "../types/domain";
const contexts = new Map<
  number,
  {
    context: PageContext;
    policy: PolicyResult;
    sanitized: ReturnType<typeof sanitizeContext>;
  }
>();
const defaultPolicy: UserPolicy = {
  deniedOrigins: [],
  allowlistedOrigins: [],
  confirmMedium: false
};
async function handleContext(
  context: PageContext,
  tabId: number | undefined
): Promise<PolicyResult> {
  const injection = assessPageInjection(context);
  const sanitized = sanitizeContext(
    context,
    "complete the user's browser task"
  );
  let origin = "unknown";
  try {
    origin = new URL(context.url).origin;
  } catch (error) {
    origin = "unknown";
  }
  const policy = evaluatePolicy({
    taskGoal: "complete the user's browser task",
    detectedData: sanitized.detections,
    pageTrust: Math.max(0, 1 - injection.risk),
    injectionRisk: injection.risk,
    origin,
    userPolicy: defaultPolicy
  });
  if (tabId !== undefined) contexts.set(tabId, { context, policy, sanitized });
  audit({
    type: "CONTEXT",
    origin,
    decision: policy.decision,
    summary: `${sanitized.detections.length} detections; injection ${injection.severity}`,
    evidence: [...injection.evidence, ...policy.reasons]
  });
  return policy;
}
chrome.runtime.onMessage.addListener(
  (message: unknown, sender: unknown, sendResponse) => {
    const senderTabId = (sender as { tab?: { id?: number } }).tab?.id;
    if (typeof message !== "object" || message === null) return false;
    const request = message as {
      type?: string;
      context?: PageContext;
      action?: BrowserAction;
      taskGoal?: string;
      tabId?: number;
    };
    const tabId = request.tabId ?? senderTabId;
    if (request.type === "PS171_CONTEXT" && request.context) {
      void handleContext(request.context, tabId)
        .then(sendResponse)
        .catch((error: unknown) => {
          audit({
            type: "ERROR",
            origin: request.context?.url ?? "unknown",
            summary: "Context processing failed",
            evidence: [error instanceof Error ? error.message : "unknown error"]
          });
          sendResponse({
            decision: "BLOCK",
            risk: 1,
            reasons: ["Context processing failed safely."],
            evidence: []
          });
        });
      return true;
    }
    if (request.type === "PS171_GET_STATUS") {
      const record = tabId === undefined ? undefined : contexts.get(tabId);
      sendResponse(
        record
          ? {
              context: record.context,
              policy: record.policy,
              sanitized: record.sanitized,
              audit: getAuditEvents()
            }
          : { audit: getAuditEvents() }
      );
      return false;
    }
    if (request.type === "PS171_EVALUATE_ACTION" && request.action) {
      const policy = evaluatePolicy({
        taskGoal: request.taskGoal ?? "",
        detectedData: [],
        pageTrust: 1,
        injectionRisk: 0,
        proposedAction: request.action,
        origin: request.action.origin,
        userPolicy: defaultPolicy
      });
      audit({
        type: "ACTION",
        origin: request.action.origin,
        decision: policy.decision,
        summary: `${request.action.type} proposed`,
        evidence: policy.reasons
      });
      sendResponse(policy);
      return false;
    }
    return false;
  }
);
