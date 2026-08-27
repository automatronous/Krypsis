import type { ActionType, BrowserAction, RiskLevel } from "../types/domain";
const riskMap: Record<ActionType, RiskLevel> = {
  SCROLL: "LOW",
  NAVIGATE: "LOW",
  CLICK: "LOW",
  TYPE: "MEDIUM",
  SUBMIT: "MEDIUM",
  DOWNLOAD: "MEDIUM",
  SEND: "HIGH",
  PUBLISH: "HIGH",
  PERMISSION_CHANGE: "HIGH",
  PAY: "CRITICAL",
  TRANSFER: "CRITICAL",
  DELETE: "CRITICAL"
};
export function actionRisk(action: BrowserAction): RiskLevel {
  return riskMap[action.type];
}
export function riskScore(level: RiskLevel): number {
  return { LOW: 0.1, MEDIUM: 0.35, HIGH: 0.7, CRITICAL: 1 }[level];
}
