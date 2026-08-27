import { actionRisk, riskScore } from "../actions/risk";
import type { PolicyInput, PolicyResult, RiskLevel } from "../types/domain";
function item(rule: string, detail: string, severity: RiskLevel) {
  return { rule, detail, severity };
}
export function evaluatePolicy(input: PolicyInput): PolicyResult {
  const reasons: string[] = [];
  const evidence: PolicyResult["evidence"] = [];
  let decision: PolicyResult["decision"] = "ALLOW";
  let risk = Math.max(
    0,
    Math.min(1, input.injectionRisk * 0.7 + (1 - input.pageTrust) * 0.3)
  );
  const setAtLeast = (candidate: PolicyResult["decision"]) => {
    const rank = { ALLOW: 0, SANITIZE: 1, CONFIRM: 2, BLOCK: 3 };
    if (rank[candidate] > rank[decision]) decision = candidate;
  };
  if (input.userPolicy.deniedOrigins.includes(input.origin)) {
    setAtLeast("BLOCK");
    risk = 1;
    reasons.push("Origin is denied by user policy.");
    evidence.push(item("DENIED_ORIGIN", input.origin, "CRITICAL"));
  }
  const types = new Set(input.detectedData.map((d) => d.type));
  if (
    types.has("PASSWORD") ||
    types.has("CARD_NUMBER") ||
    types.has("AUTH_TOKEN")
  ) {
    setAtLeast("SANITIZE");
    reasons.push(
      "High-risk secrets detected; they are hidden from agent context."
    );
    evidence.push(
      item(
        "SECRET_REDACTION",
        "Password, card, or authentication token",
        "CRITICAL"
      )
    );
  }
  if (input.injectionRisk >= 0.75) {
    setAtLeast("BLOCK");
    reasons.push(
      "High prompt-injection risk prevents page content from acting as user intent."
    );
    evidence.push(
      item(
        "PROMPT_INJECTION",
        "Page contains high-risk instruction-like content",
        "HIGH"
      )
    );
  }
  if (input.proposedAction) {
    const level = actionRisk(input.proposedAction);
    risk = Math.max(risk, riskScore(level));
    if (level === "HIGH") {
      setAtLeast("CONFIRM");
      reasons.push(
        "External communication or account-changing action requires explicit confirmation."
      );
      evidence.push(
        item("HIGH_RISK_ACTION", input.proposedAction.type, "HIGH")
      );
    }
    if (level === "CRITICAL") {
      setAtLeast("BLOCK");
      reasons.push(
        "Financial, destructive, or credential-exposing action is blocked by default."
      );
      evidence.push(
        item("CRITICAL_ACTION", input.proposedAction.type, "CRITICAL")
      );
    }
    if (level === "MEDIUM" && input.userPolicy.confirmMedium) {
      setAtLeast("CONFIRM");
      reasons.push(
        "User policy requires confirmation for medium-risk actions."
      );
      evidence.push(
        item("MEDIUM_CONFIRMATION", input.proposedAction.type, "MEDIUM")
      );
    }
  }
  if (!reasons.length)
    reasons.push(
      "No deterministic rule requires restriction; action/context is allowed and logged."
    );
  return { decision, risk, reasons, evidence };
}
