import type { Detection, PageElement, PIIType } from "../types/domain";

const patterns: Array<{
  type: PIIType;
  regex: RegExp;
  confidence: number;
  reason: string;
}> = [
  {
    type: "EMAIL",
    regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    confidence: 0.99,
    reason: "email address pattern"
  },
  {
    type: "PHONE",
    regex: /(?<!\w)(?:\+?\d[\d ()-]{5,}\d)(?!\w)/g,
    confidence: 0.88,
    reason: "phone number pattern"
  },
  {
    type: "CARD_NUMBER",
    regex: /(?<![0-9])(?:[0-9][ -]?){13,19}(?![0-9])/g,
    confidence: 0.94,
    reason: "payment card candidate with Luhn validation"
  },
  {
    type: "AUTH_TOKEN",
    regex:
      /\b(?:bearer\s+)?[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gi,
    confidence: 0.92,
    reason: "JWT-like authentication token"
  },
  {
    type: "AUTH_TOKEN",
    regex: /\b(?:secret|token|api[_ -]?key)[\w-]{4,}\b/gi,
    confidence: 0.9,
    reason: "labeled secret/token pattern"
  },
  {
    type: "ACCOUNT_NUMBER",
    regex: /\b(?:account|acct|customer)[\s:#-]*\d{6,20}\b/gi,
    confidence: 0.86,
    reason: "labeled account identifier"
  },
  {
    type: "DOB",
    regex:
      /\b(?:dob|date of birth|birth date)[\s:#-]*(?:\d{1,2}[/-]){2}\d{2,4}\b/gi,
    confidence: 0.86,
    reason: "labeled date of birth"
  },
  {
    type: "ADDRESS",
    regex:
      /\b\d{1,5}\s+[A-Z][\w.-]+\s+(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd)\b/gi,
    confidence: 0.78,
    reason: "postal address pattern"
  },
  {
    type: "SSN",
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    confidence: 0.97,
    reason: "US Social Security Number format (###-##-####)"
  },
  {
    type: "OTHER",
    regex: /\b[A-Z]{1,2}\d{7,9}\b/g,
    confidence: 0.72,
    reason: "passport or government ID number format"
  },
  {
    type: "OTHER",
    regex:
      /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
    confidence: 0.85,
    reason: "IPv4 address"
  }
];
function luhn(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let doubleIt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    const digit = Number(digits[i]);
    const value = doubleIt
      ? digit * 2 > 9
        ? digit * 2 - 9
        : digit * 2
      : digit;
    sum += value;
    doubleIt = !doubleIt;
  }
  return sum % 10 === 0;
}
export function detectText(
  text: string,
  source: "TEXT" | "VISION" = "TEXT"
): Detection[] {
  const detections: Detection[] = [];
  for (const pattern of patterns)
    for (const match of text.matchAll(pattern.regex)) {
      const value = match[0];
      const digitCount = value.replace(/\D/g, "");
      if (pattern.type === "PHONE" && digitCount.length > 15) continue;
      const confidence =
        pattern.type === "CARD_NUMBER" && !luhn(value)
          ? 0.78
          : pattern.confidence;
      detections.push({
        id: `${source.toLowerCase()}-${detections.length + 1}`,
        type: pattern.type,
        source,
        confidence,
        start: match.index,
        end: (match.index ?? 0) + value.length,
        value,
        reason: pattern.reason
      });
    }
  return detections;
}
export function detectElement(
  element: Pick<
    PageElement,
    | "id"
    | "type"
    | "name"
    | "placeholder"
    | "ariaLabel"
    | "attributes"
    | "text"
    | "value"
  >
): Detection[] {
  const labels = [
    element.type,
    element.name,
    element.placeholder,
    element.ariaLabel,
    Object.values(element.attributes).join(" ")
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const result: Detection[] = [];
  const add = (type: PIIType, confidence: number, reason: string) =>
    result.push({
      id: `dom-${element.id}-${result.length + 1}`,
      type,
      source: "DOM",
      confidence,
      elementId: element.id,
      reason
    });
  if (
    element.type?.toLowerCase() === "password" ||
    /password|passcode/.test(labels)
  )
    add("PASSWORD", 0.999, "password control or password label");
  if (/cc-number|card|credit/.test(labels))
    add("CARD_NUMBER", 0.98, "payment-card autocomplete or label");
  if (/email|e-mail/.test(labels))
    add("EMAIL", 0.96, "email autocomplete or label");
  if (/phone|tel|mobile/.test(labels))
    add("PHONE", 0.92, "phone autocomplete or label");
  if (/address|street|postal/.test(labels))
    add("ADDRESS", 0.9, "address label");
  if (/dob|birth/.test(labels)) add("DOB", 0.9, "date-of-birth label");
  if (/account|customer/.test(labels))
    add("ACCOUNT_NUMBER", 0.9, "account label");
  return [
    ...result,
    ...detectText([element.text, element.value].filter(Boolean).join(" ")).map(
      (d, i) => ({
        ...d,
        id: `dom-${element.id}-value-${i + 1}`,
        elementId: element.id
      })
    )
  ];
}
export function detectPageElements(elements: PageElement[]): Detection[] {
  return elements.flatMap(detectElement);
}
