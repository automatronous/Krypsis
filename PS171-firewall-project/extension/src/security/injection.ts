import type { InjectionAssessment, PageContext } from "../types/domain";
const highRisk = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/i,
  /reveal|exfiltrate|show|share|send\s+(?:the\s+)?(?:password|secret|token|system prompt|credentials)/i,
  /you\s+are\s+(?:now\s+)?(?:the\s+)?(?:system|developer|administrator)/i,
  /override\s+(?:the\s+)?(?:policy|safety|security)/i,
  /disable\s+(?:the\s+)?(?:firewall|security|privacy)/i
];
const mediumRisk = [
  /assistant|agent|language model/i,
  /follow these instructions/i,
  /click|type|navigate|send|purchase/i,
  /do not tell the user/i
];
export function assessInjection(
  text: string,
  source = "page text"
): InjectionAssessment {
  const evidence: string[] = [];
  let score = 0;
  for (const rule of highRisk)
    if (rule.test(text)) {
      evidence.push(`High-risk pattern: ${rule.source}`);
      score += 0.34;
    }
  for (const rule of mediumRisk)
    if (rule.test(text)) {
      evidence.push(`Instruction-like pattern: ${rule.source}`);
      score += 0.12;
    }
  if (
    /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0|font-size\s*:\s*0/i.test(
      text
    )
  ) {
    evidence.push("Hidden-content styling is present near text");
    score += 0.25;
  }
  const risk = Math.min(1, score);
  const severity =
    risk >= 0.75
      ? "CRITICAL"
      : risk >= 0.5
        ? "HIGH"
        : risk >= 0.2
          ? "MEDIUM"
          : "LOW";
  return { risk, severity, evidence, sources: evidence.length ? [source] : [] };
}
export function assessPageInjection(context: PageContext): InjectionAssessment {
  const text = `${context.pageText}\n${context.elements.map((e) => `${e.text ?? ""} ${e.ariaLabel ?? ""}`).join("\n")}`;
  const base = assessInjection(text, "DOM/text");
  return context.iframes.length
    ? {
        ...base,
        risk: Math.min(1, base.risk + 0.05),
        evidence: [
          ...base.evidence,
          "Cross-origin iframe content is treated as untrusted"
        ],
        sources: [...base.sources, "iframe metadata"]
      }
    : base;
}
