export type PIIType =
  | "EMAIL"
  | "PHONE"
  | "PERSON_NAME"
  | "ADDRESS"
  | "CARD_NUMBER"
  | "ACCOUNT_NUMBER"
  | "PASSWORD"
  | "DOB"
  | "AUTH_TOKEN"
  | "OTHER";
export type DetectionSource = "DOM" | "TEXT" | "VISION" | "MODEL";
export type PolicyDecision = "ALLOW" | "SANITIZE" | "CONFIRM" | "BLOCK";
export type ActionType =
  | "CLICK"
  | "TYPE"
  | "SCROLL"
  | "NAVIGATE"
  | "SUBMIT"
  | "DOWNLOAD"
  | "SEND"
  | "PAY"
  | "TRANSFER"
  | "DELETE"
  | "PUBLISH"
  | "PERMISSION_CHANGE";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Region extends Rect {
  hash?: string;
  reason?: string;
}
export interface PageElement {
  id: string;
  tag: string;
  role?: string;
  text?: string;
  type?: string;
  ariaLabel?: string;
  placeholder?: string;
  name?: string;
  value?: string;
  rect: Rect;
  attributes: Record<string, string>;
  visible: boolean;
  enabled: boolean;
  sensitive: boolean;
}
export interface FormInfo {
  id: string;
  action: string;
  method: string;
  fieldCount: number;
  hasPassword: boolean;
}
export interface IFrameInfo {
  src: string;
  origin: string;
  sameOrigin: boolean;
}
export interface PageContext {
  url: string;
  title: string;
  pageText: string;
  elements: PageElement[];
  forms: FormInfo[];
  iframes: IFrameInfo[];
  changedRegions: Region[];
  screenshotRegions: Region[];
  timestamp: number;
  mutationCount: number;
}
export interface Detection {
  id: string;
  type: PIIType;
  source: DetectionSource;
  confidence: number;
  elementId?: string;
  start?: number;
  end?: number;
  value?: string;
  reason: string;
}
export interface BrowserAction {
  id: string;
  type: ActionType;
  target?: { elementId?: string; x?: number; y?: number; label?: string };
  value?: string;
  origin: string;
}
export interface UserPolicy {
  deniedOrigins: string[];
  confirmMedium: boolean;
  allowlistedOrigins: string[];
}
export interface PolicyEvidence {
  rule: string;
  detail: string;
  severity: RiskLevel;
}
export interface PolicyInput {
  taskGoal: string;
  detectedData: Detection[];
  pageTrust: number;
  injectionRisk: number;
  proposedAction?: BrowserAction;
  origin: string;
  userPolicy: UserPolicy;
}
export interface PolicyResult {
  decision: PolicyDecision;
  risk: number;
  reasons: string[];
  evidence: PolicyEvidence[];
}
export interface InjectionAssessment {
  risk: number;
  severity: RiskLevel;
  evidence: string[];
  sources: string[];
}
export interface DisclosureRequest {
  taskGoal: string;
  availableContext: PageContext;
}
export interface DisclosureDecision {
  allowedFields: string[];
  sanitizedContext: string;
  reasons: string[];
  detections: Detection[];
}
export interface AuditEvent {
  id: string;
  timestamp: number;
  type: "CONTEXT" | "ACTION" | "ERROR";
  origin: string;
  decision?: PolicyDecision;
  summary: string;
  evidence: string[];
}
