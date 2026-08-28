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

const POLICY_STORAGE_KEY = "ps171_user_policy";

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

/** Cached user policy — updated whenever storage changes. */
let userPolicy: UserPolicy = { ...defaultPolicy };

/** Load persisted user policy from chrome.storage.local. */
async function loadUserPolicy(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(POLICY_STORAGE_KEY);
    const stored = result[POLICY_STORAGE_KEY] as UserPolicy | undefined;
    if (stored && typeof stored === "object") {
      userPolicy = {
        deniedOrigins: Array.isArray(stored.deniedOrigins)
          ? stored.deniedOrigins
          : [],
        allowlistedOrigins: Array.isArray(stored.allowlistedOrigins)
          ? stored.allowlistedOrigins
          : [],
        confirmMedium:
          typeof stored.confirmMedium === "boolean"
            ? stored.confirmMedium
            : false
      };
    }
  } catch {
    // Storage unavailable — keep defaults
  }
}

// Hot-reload policy when the user changes settings in the Options page
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && POLICY_STORAGE_KEY in changes) {
    void loadUserPolicy();
  }
});

// Load policy on service worker startup
void loadUserPolicy();

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
  } catch {
    origin = "unknown";
  }
  const policy = evaluatePolicy({
    taskGoal: "complete the user's browser task",
    detectedData: sanitized.detections,
    pageTrust: Math.max(0, 1 - injection.risk),
    injectionRisk: injection.risk,
    origin,
    userPolicy
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
      void getAuditEvents().then((auditEvents) => {
        sendResponse(
          record
            ? {
                context: record.context,
                policy: record.policy,
                sanitized: record.sanitized,
                audit: auditEvents
              }
            : { audit: auditEvents }
        );
      });
      return true;
    }

    if (request.type === "PS171_EVALUATE_ACTION" && request.action) {
      const policy = evaluatePolicy({
        taskGoal: request.taskGoal ?? "",
        detectedData: [],
        pageTrust: 1,
        injectionRisk: 0,
        proposedAction: request.action,
        origin: request.action.origin,
        userPolicy
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

    if (request.type === "PS171_SAVE_POLICY" && request.action === undefined) {
      const incoming = (message as { policy?: unknown }).policy as
        | UserPolicy
        | undefined;
      if (incoming) {
        userPolicy = {
          deniedOrigins: Array.isArray(incoming.deniedOrigins)
            ? incoming.deniedOrigins
            : [],
          allowlistedOrigins: Array.isArray(incoming.allowlistedOrigins)
            ? incoming.allowlistedOrigins
            : [],
          confirmMedium:
            typeof incoming.confirmMedium === "boolean"
              ? incoming.confirmMedium
              : false
        };
        void chrome.storage.local.set({ [POLICY_STORAGE_KEY]: userPolicy });
        sendResponse({ ok: true });
      }
      return false;
    }

    return false;
  }
);
