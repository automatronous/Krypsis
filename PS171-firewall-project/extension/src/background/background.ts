import { assessPageInjection } from "../security/injection";
import { evaluatePolicy } from "../policy/policy";
import { sanitizeContext } from "../sanitizer/sanitizer";
import { audit, getAuditEvents } from "../security/audit";
import { runAgentPipeline } from "../vision/pipeline";
import type {
  AgentAction,
  AgentRequest,
  BrowserAction,
  PageContext,
  PolicyResult,
  UserPolicy
} from "../types/domain";

const POLICY_STORAGE_KEY = "ps171_user_policy";
const SERVER_URL_KEY = "ps171_server_url";
const DEFAULT_SERVER_URL = "http://localhost:3001";

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

let userPolicy: UserPolicy = { ...defaultPolicy };
let serverUrl: string = DEFAULT_SERVER_URL;

async function loadSettings(): Promise<void> {
  try {
    const result = await chrome.storage.local.get([
      POLICY_STORAGE_KEY,
      SERVER_URL_KEY
    ]);
    const stored = result[POLICY_STORAGE_KEY] as UserPolicy | undefined;
    if (stored && typeof stored === "object") {
      userPolicy = {
        deniedOrigins: Array.isArray(stored.deniedOrigins) ? stored.deniedOrigins : [],
        allowlistedOrigins: Array.isArray(stored.allowlistedOrigins) ? stored.allowlistedOrigins : [],
        confirmMedium: typeof stored.confirmMedium === "boolean" ? stored.confirmMedium : false
      };
    }
    if (typeof result[SERVER_URL_KEY] === "string") {
      serverUrl = result[SERVER_URL_KEY] as string;
    }
  } catch {
    // Use defaults
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    if (POLICY_STORAGE_KEY in changes) void loadSettings();
    if (SERVER_URL_KEY in changes) void loadSettings();
  }
});

void loadSettings();

async function handleContext(
  context: PageContext,
  tabId: number | undefined
): Promise<PolicyResult> {
  const injection = assessPageInjection(context);
  const sanitized = sanitizeContext(context, "complete the user's browser task");
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
      agentRequest?: AgentRequest;
      agentActions?: AgentAction[];
      policy?: UserPolicy;
    };
    const tabId = request.tabId ?? senderTabId;

    // --- Regular context update from content script ---
    if (request.type === "PS171_CONTEXT" && request.context) {
      void handleContext(request.context, tabId)
        .then(sendResponse)
        .catch((err: unknown) => {
          audit({
            type: "ERROR",
            origin: request.context?.url ?? "unknown",
            summary: "Context processing failed",
            evidence: [err instanceof Error ? err.message : "unknown error"]
          });
          sendResponse({ decision: "BLOCK", risk: 1, reasons: ["Processing failed."], evidence: [] });
        });
      return true;
    }

    // --- Status query from popup ---
    if (request.type === "PS171_GET_STATUS") {
      const record = tabId === undefined ? undefined : contexts.get(tabId);
      void getAuditEvents().then((auditEvents) => {
        sendResponse(
          record
            ? { context: record.context, policy: record.policy, sanitized: record.sanitized, audit: auditEvents, serverUrl }
            : { audit: auditEvents, serverUrl }
        );
      });
      return true;
    }

    // --- Evaluate a proposed action ---
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

    // --- Save policy from options page ---
    if (request.type === "PS171_SAVE_POLICY" && request.policy) {
      userPolicy = {
        deniedOrigins: Array.isArray(request.policy.deniedOrigins) ? request.policy.deniedOrigins : [],
        allowlistedOrigins: Array.isArray(request.policy.allowlistedOrigins) ? request.policy.allowlistedOrigins : [],
        confirmMedium: typeof request.policy.confirmMedium === "boolean" ? request.policy.confirmMedium : false
      };
      void chrome.storage.local.set({ [POLICY_STORAGE_KEY]: userPolicy });
      sendResponse({ ok: true });
      return false;
    }

    // --- Save server URL from options page ---
    if (request.type === "PS171_SAVE_SERVER_URL" && typeof (request as { url?: string }).url === "string") {
      serverUrl = (request as { url: string }).url;
      void chrome.storage.local.set({ [SERVER_URL_KEY]: serverUrl });
      sendResponse({ ok: true });
      return false;
    }

    // --- Run the full vision agent pipeline ---
    if (request.type === "PS171_RUN_AGENT" && request.agentRequest && tabId !== undefined) {
      const agentRequest: AgentRequest = {
        ...request.agentRequest,
        serverUrl: request.agentRequest.serverUrl || serverUrl
      };
      
      (async () => {
        let record = contexts.get(tabId);
        if (!record) {
          try {
            const ctx = (await chrome.tabs.sendMessage(tabId, "PS171_GET_CONTEXT")) as PageContext;
            if (ctx) {
              await handleContext(ctx, tabId);
              record = contexts.get(tabId);
            }
          } catch {
            /* content script not available */
          }
        }
        if (!record) {
          sendResponse({ stage: "ERROR", error: "No page context — refresh the active web page first.", actions: [], redactionCount: 0, latencyMs: 0, summary: "" });
          return;
        }
        try {
          const res = await runAgentPipeline({ request: agentRequest, context: record.context, userPolicy });
          sendResponse(res);
        } catch (err: unknown) {
          sendResponse({ stage: "ERROR", error: err instanceof Error ? err.message : "Pipeline failed", actions: [], redactionCount: 0, latencyMs: 0, summary: "" });
        }
      })();
      return true;
    }

    // --- Execute approved actions in the tab ---
    if (request.type === "PS171_EXECUTE_ACTIONS" && Array.isArray(request.agentActions) && tabId !== undefined) {
      const actions = request.agentActions as AgentAction[];
      const results: unknown[] = [];
      (async () => {
        for (let i = 0; i < actions.length; i++) {
          try {
            const result = await chrome.tabs.sendMessage(tabId, {
              type: "PS171_EXECUTE_ACTION",
              action: actions[i],
              index: i
            });
            results.push(result);
            // Small delay between actions to let page react
            if (i < actions.length - 1) await new Promise((r) => setTimeout(r, 600));
          } catch (err) {
            results.push({ actionIndex: i, success: false, error: err instanceof Error ? err.message : "failed" });
          }
        }
        sendResponse({ results });
      })();
      return true;
    }

    // --- Multi-Step Autonomous Task Chain ---
    if (request.type === "PS171_RUN_CHAIN" && request.agentRequest && tabId !== undefined) {
      const MAX_STEPS = (request as { maxSteps?: number }).maxSteps ?? 8;
      const agentRequest: AgentRequest = {
        ...request.agentRequest,
        serverUrl: request.agentRequest.serverUrl || serverUrl
      };

      (async () => {
        const steps: Array<{ stepIndex: number; summary: string; actionsExecuted: number; redactedScreenshot?: string; goalMet: boolean }> = [];
        let abortReason: string | undefined;
        let goalMet = false;

        for (let step = 0; step < MAX_STEPS; step++) {
          // Re-fetch fresh page context after page may have navigated
          let record = contexts.get(tabId);
          try {
            const ctx = (await chrome.tabs.sendMessage(tabId, "PS171_GET_CONTEXT")) as PageContext;
            if (ctx) {
              await handleContext(ctx, tabId);
              record = contexts.get(tabId);
            }
          } catch {
            /* content script not injected yet, use last known context */
          }

          if (!record) {
            abortReason = "No page context — page may still be loading.";
            break;
          }

          // Run the full privacy pipeline (capture → redact → plan)
          let pipelineResult;
          try {
            pipelineResult = await runAgentPipeline({ request: agentRequest, context: record.context, userPolicy });
          } catch (err) {
            abortReason = err instanceof Error ? err.message : "Pipeline error";
            break;
          }

          if (pipelineResult.stage === "ERROR") {
            abortReason = pipelineResult.error ?? "Pipeline returned error stage";
            break;
          }

          // Fast execution of returned actions
          const actions = pipelineResult.actions ?? [];
          let actionsExecuted = 0;
          let hadNavigationAction = false;

          for (let i = 0; i < actions.length; i++) {
            const action = actions[i]!;
            try {
              await chrome.tabs.sendMessage(tabId, {
                type: "PS171_EXECUTE_ACTION",
                action,
                index: i
              });
              actionsExecuted++;
              if (action.type === "NAVIGATE" || action.type === "SUBMIT") hadNavigationAction = true;
              if (i < actions.length - 1) await new Promise((r) => setTimeout(r, 200));
            } catch {
              /* element may have moved, continue */
            }
          }

          // Detect goal completion from VLM summary keywords
          const summaryLower = (pipelineResult.summary ?? "").toLowerCase();
          goalMet =
            summaryLower.includes("goal complete") ||
            summaryLower.includes("task complete") ||
            summaryLower.includes("successfully") ||
            summaryLower.includes("done") ||
            summaryLower.includes("finished") ||
            actions.length === 0; // No more actions = goal reached

          steps.push({
            stepIndex: step + 1,
            summary: pipelineResult.summary,
            actionsExecuted,
            redactedScreenshot: pipelineResult.redactedScreenshot,
            goalMet
          });

          if (goalMet) break;

          // Minimal settle delay for fastest execution route
          const settleMs = hadNavigationAction ? 600 : 300;
          await new Promise((r) => setTimeout(r, settleMs));
        }

        sendResponse({ steps, totalSteps: steps.length, goalMet, abortReason });
      })();
      return true;
    }

    return false;
  }
);
