/**
 * pipeline.ts
 * End-to-end privacy-preserving vision agent pipeline:
 *
 *   1. Capture → screenshot from active tab
 *   2. Detect  → compute redaction regions from DOM context
 *   2.5. OCR  → extract visible text regions from screenshot
 *   3. Redact  → apply canvas-based pixel redaction
 *   4. Transmit → POST sanitized data to local server
 *   5. Plan    → receive action list from server VLM
 *   6. Policy  → gate each action through existing PS171 policy engine
 *   7. Return  → approved actions + redacted screenshot back to popup
 */

import { captureActiveTab } from "./capture";
import { computeRedactionRegions, redactScreenshot } from "./redactor";
import { detectSensitiveRegionsML } from "./localModel";
import { extractTextRegions, getOCRTextContent } from "./ocr";
import { evaluatePolicy } from "../policy/policy";
import { audit } from "../security/audit";
import type {
  AgentAction,
  AgentRequest,
  AgentResult,
  PageContext,
  UserPolicy
} from "../types/domain";

export interface PipelineOptions {
  request: AgentRequest;
  context: PageContext;
  userPolicy: UserPolicy;
}

interface ServerResponse {
  actions: AgentAction[];
  summary: string;
  error?: string;
}

async function transmitToServer(
  serverUrl: string,
  payload: {
    screenshot_b64: string;
    dom_summary: object;
    task_goal: string;
    redacted_regions: object[];
    page_url: string;
    ocr_text?: Array<{ text: string; confidence: number }>;
  }
): Promise<ServerResponse> {
  const resp = await fetch(`${serverUrl}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000)
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "unknown error");
    throw new Error(`Server error ${resp.status}: ${text}`);
  }
  return resp.json() as Promise<ServerResponse>;
}

/** Build a compact DOM summary to send to server (avoids sending raw pageText). */
function buildDomSummary(context: PageContext): object {
  return {
    url: context.url,
    title: context.title,
    viewport: {
      width: context.viewportWidth,
      height: context.viewportHeight
    },
    elementCount: context.elements.length,
    sensitiveCount: context.elements.filter((e) => e.sensitive).length,
    forms: context.forms.map((f) => ({
      id: f.id,
      action: f.action,
      method: f.method,
      hasPassword: f.hasPassword
    })),
    interactables: context.elements
      .filter((e) => e.visible && e.enabled)
      .slice(0, 60)
      .map((e) => ({
        id: e.id,
        tag: e.tag,
        type: e.type,
        role: e.role,
        text: e.text?.slice(0, 80),
        ariaLabel: e.ariaLabel?.slice(0, 80),
        placeholder: e.placeholder?.slice(0, 60),
        name: e.name,
        sensitive: e.sensitive,
        rect: e.rect
      }))
  };
}

/**
 * Run the full privacy-preserving agent pipeline.
 * Called from background.ts in response to PS171_RUN_AGENT message.
 */
export async function runAgentPipeline(
  options: PipelineOptions
): Promise<AgentResult> {
  const started = performance.now();
  const { request, context, userPolicy } = options;

  // --- Stage 1: Capture ---
  let screenshotDataUrl: string;
  try {
    screenshotDataUrl = await captureActiveTab();
  } catch (err) {
    return {
      actions: [],
      summary: "Screen capture failed.",
      redactionCount: 0,
      latencyMs: performance.now() - started,
      stage: "ERROR",
      error: err instanceof Error ? err.message : "Capture failed"
    };
  }

  // --- Stage 2: Detect + Redact ---
  const domRegions = computeRedactionRegions(context);
  const mlRegions = await detectSensitiveRegionsML(screenshotDataUrl);
  let regions = [...domRegions, ...mlRegions];

  // --- Stage 2.5: OCR text extraction ---
  let ocrTextContent: Array<{ text: string; confidence: number }> = [];
  try {
    const ocrRegions = await extractTextRegions(screenshotDataUrl);
    ocrTextContent = getOCRTextContent(ocrRegions);
    console.log(`OCR extracted ${ocrRegions.length} text regions`);
  } catch (err) {
    console.warn("OCR extraction encountered an issue, continuing without it:", err);
  }

  let redactedDataUrl: string;
  let redactionCount: number;
  try {
    const result = await redactScreenshot(screenshotDataUrl, regions);
    redactedDataUrl = result.dataUrl;
    redactionCount = result.appliedCount;
  } catch (err) {
    return {
      actions: [],
      summary: "Visual redaction failed.",
      redactionCount: 0,
      latencyMs: performance.now() - started,
      stage: "ERROR",
      error: err instanceof Error ? err.message : "Redaction failed"
    };
  }

  // Strip the data URL prefix to get raw base64
  const base64 = redactedDataUrl.replace(/^data:image\/\w+;base64,/, "");

  // --- Stage 3: Transmit ---
  let serverResponse: ServerResponse;
  try {
    serverResponse = await transmitToServer(request.serverUrl, {
      screenshot_b64: base64,
      dom_summary: buildDomSummary(context),
      task_goal: request.taskGoal,
      redacted_regions: regions,
      page_url: context.url,
      ocr_text: ocrTextContent.length > 0 ? ocrTextContent : undefined
    });
  } catch (err) {
    audit({
      type: "ERROR",
      origin: context.url,
      summary: "Server transmission failed",
      evidence: [err instanceof Error ? err.message : "unknown"]
    });
    return {
      actions: [],
      summary: "Server unreachable. Check that the Krypsis server is running.",
      redactedScreenshot: redactedDataUrl,
      redactionCount,
      latencyMs: performance.now() - started,
      stage: "ERROR",
      error: err instanceof Error ? err.message : "Network error"
    };
  }

  if (serverResponse.error) {
    return {
      actions: [],
      summary: serverResponse.error,
      redactedScreenshot: redactedDataUrl,
      redactionCount,
      latencyMs: performance.now() - started,
      stage: "ERROR",
      error: serverResponse.error
    };
  }

  // --- Stage 4: Policy gate each action ---
  let origin = "unknown";
  try {
    origin = new URL(context.url).origin;
  } catch {
    origin = "unknown";
  }

  const approvedActions: AgentAction[] = [];
  for (const action of serverResponse.actions) {
    const policyInput = {
      taskGoal: request.taskGoal,
      detectedData: [],
      pageTrust: 1,
      injectionRisk: 0,
      proposedAction: {
        id: crypto.randomUUID(),
        type: action.type,
        target: action.selector ? { elementId: action.selector } : undefined,
        value: action.value,
        origin
      },
      origin,
      userPolicy
    };
    const result = evaluatePolicy(policyInput);
    audit({
      type: "ACTION",
      origin,
      decision: result.decision,
      summary: `Agent action ${action.type} — ${action.label}`,
      evidence: result.reasons
    });
    if (result.decision !== "BLOCK") {
      approvedActions.push(action);
    }
  }

  return {
    actions: approvedActions,
    summary: serverResponse.summary,
    redactedScreenshot: redactedDataUrl,
    redactionCount,
    latencyMs: performance.now() - started,
    stage: approvedActions.length > 0 ? "CONFIRM" : "DONE"
  };
}
