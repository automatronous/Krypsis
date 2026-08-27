"use strict";
(() => {
  // extension/src/security/injection.ts
  var highRisk = [
    /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/i,
    /reveal|exfiltrate|show|share|send\s+(?:the\s+)?(?:password|secret|token|system prompt|credentials)/i,
    /you\s+are\s+(?:now\s+)?(?:the\s+)?(?:system|developer|administrator)/i,
    /override\s+(?:the\s+)?(?:policy|safety|security)/i,
    /disable\s+(?:the\s+)?(?:firewall|security|privacy)/i
  ];
  var mediumRisk = [
    /assistant|agent|language model/i,
    /follow these instructions/i,
    /click|type|navigate|send|purchase/i,
    /do not tell the user/i
  ];
  function assessInjection(text, source = "page text") {
    const evidence = [];
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
    if (/display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0|font-size\s*:\s*0/i.test(
      text
    )) {
      evidence.push("Hidden-content styling is present near text");
      score += 0.25;
    }
    const risk = Math.min(1, score);
    const severity = risk >= 0.75 ? "CRITICAL" : risk >= 0.5 ? "HIGH" : risk >= 0.2 ? "MEDIUM" : "LOW";
    return { risk, severity, evidence, sources: evidence.length ? [source] : [] };
  }
  function assessPageInjection(context) {
    const text = `${context.pageText}
${context.elements.map((e) => `${e.text ?? ""} ${e.ariaLabel ?? ""}`).join("\n")}`;
    const base = assessInjection(text, "DOM/text");
    return context.iframes.length ? {
      ...base,
      risk: Math.min(1, base.risk + 0.05),
      evidence: [
        ...base.evidence,
        "Cross-origin iframe content is treated as untrusted"
      ],
      sources: [...base.sources, "iframe metadata"]
    } : base;
  }

  // extension/src/actions/risk.ts
  var riskMap = {
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
  function actionRisk(action) {
    return riskMap[action.type];
  }
  function riskScore(level) {
    return { LOW: 0.1, MEDIUM: 0.35, HIGH: 0.7, CRITICAL: 1 }[level];
  }

  // extension/src/policy/policy.ts
  function item(rule, detail, severity) {
    return { rule, detail, severity };
  }
  function evaluatePolicy(input) {
    const reasons = [];
    const evidence = [];
    let decision = "ALLOW";
    let risk = Math.max(
      0,
      Math.min(1, input.injectionRisk * 0.7 + (1 - input.pageTrust) * 0.3)
    );
    const setAtLeast = (candidate) => {
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
    if (types.has("PASSWORD") || types.has("CARD_NUMBER") || types.has("AUTH_TOKEN")) {
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

  // extension/src/security/pii.ts
  var patterns = [
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
      regex: /\b(?:bearer\s+)?[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gi,
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
      regex: /\b(?:dob|date of birth|birth date)[\s:#-]*(?:\d{1,2}[/-]){2}\d{2,4}\b/gi,
      confidence: 0.86,
      reason: "labeled date of birth"
    },
    {
      type: "ADDRESS",
      regex: /\b\d{1,5}\s+[A-Z][\w.-]+\s+(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd)\b/gi,
      confidence: 0.78,
      reason: "postal address pattern"
    }
  ];
  function luhn(candidate) {
    const digits = candidate.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) return false;
    let sum = 0;
    let doubleIt = false;
    for (let i = digits.length - 1; i >= 0; i -= 1) {
      const digit = Number(digits[i]);
      const value = doubleIt ? digit * 2 > 9 ? digit * 2 - 9 : digit * 2 : digit;
      sum += value;
      doubleIt = !doubleIt;
    }
    return sum % 10 === 0;
  }
  function detectText(text, source = "TEXT") {
    const detections = [];
    for (const pattern of patterns)
      for (const match of text.matchAll(pattern.regex)) {
        const value = match[0];
        const digitCount = value.replace(/\D/g, "");
        if (pattern.type === "PHONE" && digitCount.length > 15) continue;
        const confidence = pattern.type === "CARD_NUMBER" && !luhn(value) ? 0.78 : pattern.confidence;
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

  // extension/src/sanitizer/sanitizer.ts
  var taskKeywords = {
    EMAIL: ["email", "contact", "message", "notify"],
    PERSON_NAME: ["name", "who", "customer"],
    ADDRESS: ["address", "ship", "delivery"],
    ACCOUNT_NUMBER: ["account", "customer id"],
    DOB: ["birth", "age", "identity"]
  };
  function needed(task, type) {
    return (taskKeywords[type] ?? []).some(
      (word) => task.toLowerCase().includes(word)
    );
  }
  function replacement(type, value, task) {
    if (type === "EMAIL" && !needed(task, type)) {
      const [local, domain] = value.split("@");
      return `${local?.[0] ?? "*"}***@${domain ?? "hidden"}`;
    }
    return `[${type}]`;
  }
  function sanitizeText(text, taskGoal) {
    const detections = detectText(text);
    let output = text;
    for (const detection of [...detections].sort(
      (a, b) => (b.start ?? 0) - (a.start ?? 0)
    )) {
      if (detection.start === void 0 || detection.end === void 0 || !detection.value)
        continue;
      output = `${output.slice(0, detection.start)}${replacement(detection.type, detection.value, taskGoal)}${output.slice(detection.end)}`;
    }
    return { text: output, detections };
  }
  function sanitizeContext(context, taskGoal) {
    const values = [
      context.title,
      context.pageText,
      ...context.elements.map(
        (element) => [element.text, element.ariaLabel, element.placeholder].filter(Boolean).join(" ")
      )
    ].filter(Boolean).join("\n");
    const sanitized = sanitizeText(values, taskGoal);
    const elementDetections = context.elements.filter((element) => element.sensitive).map((element) => ({
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

  // extension/src/security/audit.ts
  var events = [];
  function audit(event) {
    const safe = {
      ...event,
      evidence: event.evidence.map((item2) => item2.slice(0, 240)),
      id: crypto.randomUUID(),
      timestamp: Date.now()
    };
    events.push(safe);
    if (events.length > 100) events.shift();
    return safe;
  }
  function getAuditEvents() {
    return events.map((event) => ({ ...event, evidence: [...event.evidence] }));
  }

  // extension/src/background/background.ts
  var contexts = /* @__PURE__ */ new Map();
  var defaultPolicy = {
    deniedOrigins: [],
    allowlistedOrigins: [],
    confirmMedium: false
  };
  async function handleContext(context, tabId) {
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
    if (tabId !== void 0) contexts.set(tabId, { context, policy, sanitized });
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
    (message, sender, sendResponse) => {
      const senderTabId = sender.tab?.id;
      if (typeof message !== "object" || message === null) return false;
      const request = message;
      const tabId = request.tabId ?? senderTabId;
      if (request.type === "PS171_CONTEXT" && request.context) {
        void handleContext(request.context, tabId).then(sendResponse).catch((error) => {
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
        const record = tabId === void 0 ? void 0 : contexts.get(tabId);
        sendResponse(
          record ? {
            context: record.context,
            policy: record.policy,
            sanitized: record.sanitized,
            audit: getAuditEvents()
          } : { audit: getAuditEvents() }
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
})();
//# sourceMappingURL=background.js.map
