import { detectText } from "../security/pii";
import type {
  Detection,
  DisclosureDecision,
  DisclosureRequest,
  PageContext
} from "../types/domain";
const taskKeywords: Record<string, string[]> = {
  EMAIL: ["email", "contact", "message", "notify"],
  PERSON_NAME: ["name", "who", "customer"],
  ADDRESS: ["address", "ship", "delivery"],
  ACCOUNT_NUMBER: ["account", "customer id"],
  DOB: ["birth", "age", "identity"]
};
function needed(task: string, type: string): boolean {
  return (taskKeywords[type] ?? []).some((word) =>
    task.toLowerCase().includes(word)
  );
}
function replacement(type: string, value: string, task: string): string {
  if (type === "EMAIL" && !needed(task, type)) {
    const [local, domain] = value.split("@");
    return `${local?.[0] ?? "*"}***@${domain ?? "hidden"}`;
  }
  return `[${type}]`;
}
export function sanitizeText(
  text: string,
  taskGoal: string
): { text: string; detections: Detection[] } {
  const detections = detectText(text);
  let output = text;
  for (const detection of [...detections].sort(
    (a, b) => (b.start ?? 0) - (a.start ?? 0)
  )) {
    if (
      detection.start === undefined ||
      detection.end === undefined ||
      !detection.value
    )
      continue;
    output = `${output.slice(0, detection.start)}${replacement(detection.type, detection.value, taskGoal)}${output.slice(detection.end)}`;
  }
  return { text: output, detections };
}
export function sanitizeContext(
  context: PageContext,
  taskGoal: string
): DisclosureDecision {
  const values = [
    context.title,
    context.pageText,
    ...context.elements.map((element) =>
      [element.text, element.ariaLabel, element.placeholder]
        .filter(Boolean)
        .join(" ")
    )
  ]
    .filter(Boolean)
    .join("\n");
  const sanitized = sanitizeText(values, taskGoal);
  const elementDetections: Detection[] = context.elements
    .filter((element) => element.sensitive)
    .map((element) => ({
      id: `element-${element.id}`,
      type: "OTHER",
      source: "DOM",
      confidence: 0.9,
      elementId: element.id,
      reason: "element marked sensitive"
    }));
  return {
    allowedFields: [
      "title",
      "task-relevant visible text",
      "non-sensitive controls"
    ],
    sanitizedContext: sanitized.text,
    reasons: [
      "DOM and deterministic rules were evaluated locally.",
      "Passwords, payment cards, tokens, and account secrets are never disclosed by default.",
      "Only task-relevant fields are retained; email is masked unless the task explicitly requires it."
    ],
    detections: [...sanitized.detections, ...elementDetections]
  };
}
export function disclosureFor(request: DisclosureRequest): DisclosureDecision {
  return sanitizeContext(request.availableContext, request.taskGoal);
}
