"use strict";
(() => {
  // extension/src/security/injection.ts
  var highRisk = [
    /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/i,
    /reveal|exfiltrate|show|share|send\s+(?:the\s+)?(?:password|secret|token|system prompt|credentials)/i,
    /you\s+are\s+(?:now\s+)?(?:the\s+)?(?:system|developer|administrator)/i,
    /override\s+(?:the\s+)?(?:policy|safety|security)/i,
    /disable\s+(?:the\s+)?(?:firewall|security|privacy)/i,
    // Role-switching attacks
    /act\s+as\s+(?:a|an|the)\s+\w+/i,
    /pretend\s+(?:you\s+are|to\s+be)\s+/i,
    /from\s+now\s+on\s+you\s+(?:are|will)/i,
    // XML / conversation boundary injection
    /<\s*(?:system|human|assistant|user|prompt)\s*>/i,
    /\n{2,}(?:###\s*|Human:\s*|Assistant:\s*|System:\s*)/,
    // URL-based data exfiltration
    /https?:\/\/[^\s"'<>]{0,80}\?[^\s"'<>]{0,40}(?:data|token|secret|key|pass)=/i
  ];
  var mediumRisk = [
    /assistant|agent|language model/i,
    /follow these instructions/i,
    /click|type|navigate|send|purchase/i,
    /do not tell the user/i,
    /you must|you should|you need to/i,
    /your (?:task|goal|objective|job) is now/i,
    /new (?:instructions|directives|commands|task)/i,
    /remember to (?:always|never)/i
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
      regex: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
      confidence: 0.85,
      reason: "IPv4 address"
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
  var STORAGE_KEY = "ps171_audit";
  var MAX_EVENTS = 100;
  var events = [];
  var loaded = false;
  async function ensureLoaded() {
    if (loaded) return;
    loaded = true;
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const stored = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
      events.push(...stored.slice(-MAX_EVENTS));
    } catch {
    }
  }
  function persist() {
    try {
      void chrome.storage.local.set({ [STORAGE_KEY]: events.slice(-MAX_EVENTS) });
    } catch {
    }
  }
  function audit(event) {
    const safe = {
      ...event,
      evidence: event.evidence.map((item2) => item2.slice(0, 240)),
      id: crypto.randomUUID(),
      timestamp: Date.now()
    };
    events.push(safe);
    if (events.length > MAX_EVENTS) events.shift();
    persist();
    return safe;
  }
  async function getAuditEvents() {
    await ensureLoaded();
    return events.map((event) => ({ ...event, evidence: [...event.evidence] }));
  }

  // extension/src/vision/capture.ts
  async function captureActiveTab() {
    return chrome.tabs.captureVisibleTab(null, { format: "png", quality: 90 });
  }

  // extension/src/vision/redactor.ts
  async function loadBitmap(dataUrl) {
    const resp = await fetch(dataUrl);
    const blob = await resp.blob();
    return createImageBitmap(blob);
  }
  async function canvasToDataUrl(canvas) {
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const buffer = await new Response(blob).arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return `data:image/png;base64,${btoa(binary)}`;
  }
  function pixelate(ctx, x, y, w, h, blockSize) {
    if (w <= 0 || h <= 0) return;
    const tiny = new OffscreenCanvas(
      Math.max(1, Math.round(w / blockSize)),
      Math.max(1, Math.round(h / blockSize))
    );
    const tCtx = tiny.getContext("2d");
    tCtx.drawImage(ctx.canvas, x, y, w, h, 0, 0, tiny.width, tiny.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tiny, 0, 0, tiny.width, tiny.height, x, y, w, h);
    ctx.imageSmoothingEnabled = true;
  }
  function computeRedactionRegions(context) {
    const dpr = context.devicePixelRatio || 1;
    const regions = [];
    for (const el of context.elements) {
      if (!el.visible) continue;
      const { x, y, width, height } = el.rect;
      if (width <= 0 || height <= 0) continue;
      if (el.type === "password" || el.sensitive || /password|passcode|cvv|cvc|pin/i.test(
        [el.name, el.placeholder, el.ariaLabel].filter(Boolean).join(" ")
      )) {
        regions.push({
          x: Math.round(x * dpr),
          y: Math.round(y * dpr),
          width: Math.round(width * dpr),
          height: Math.round(height * dpr),
          redactionType: "BLACKOUT",
          reason: `${el.type ?? el.tag} \u2014 password or sensitive control`
        });
        continue;
      }
      if (/card|credit|account|iban|routing/i.test(
        [el.name, el.placeholder, el.ariaLabel, el.type].filter(Boolean).join(" ")
      )) {
        regions.push({
          x: Math.round(x * dpr),
          y: Math.round(y * dpr),
          width: Math.round(width * dpr),
          height: Math.round(height * dpr),
          redactionType: "PIXELATE",
          reason: "financial field"
        });
        continue;
      }
      if (el.tag === "img" && width >= 40 && height >= 40 && height / width >= 0.7 && height / width <= 1.8) {
        regions.push({
          x: Math.round(x * dpr),
          y: Math.round(y * dpr),
          width: Math.round(width * dpr),
          height: Math.round(height * dpr),
          redactionType: "BLUR",
          reason: "potential face / profile image"
        });
      }
    }
    return regions;
  }
  async function redactScreenshot(screenshotDataUrl, regions) {
    const bitmap = await loadBitmap(screenshotDataUrl);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    let appliedCount = 0;
    for (const region of regions) {
      const { x, y, width, height, redactionType } = region;
      if (width <= 0 || height <= 0) continue;
      switch (redactionType) {
        case "BLACKOUT":
          ctx.fillStyle = "#000000";
          ctx.fillRect(x, y, width, height);
          break;
        case "BLUR":
          pixelate(ctx, x, y, width, height, 12);
          break;
        case "PIXELATE":
          pixelate(ctx, x, y, width, height, 6);
          break;
      }
      appliedCount++;
    }
    ctx.strokeStyle = "rgba(255, 60, 60, 0.7)";
    ctx.lineWidth = 2;
    for (const r of regions) {
      if (r.width > 0 && r.height > 0) {
        ctx.strokeRect(r.x + 1, r.y + 1, r.width - 2, r.height - 2);
      }
    }
    const dataUrl = await canvasToDataUrl(canvas);
    return { dataUrl, appliedCount };
  }

  // extension/src/vision/pipeline.ts
  async function transmitToServer(serverUrl2, payload) {
    const resp = await fetch(`${serverUrl2}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3e4)
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "unknown error");
      throw new Error(`Server error ${resp.status}: ${text}`);
    }
    return resp.json();
  }
  function buildDomSummary(context) {
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
      interactables: context.elements.filter((e) => e.visible && e.enabled).slice(0, 60).map((e) => ({
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
  async function runAgentPipeline(options) {
    const started = performance.now();
    const { request, context, userPolicy: userPolicy2 } = options;
    let screenshotDataUrl;
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
    const regions = computeRedactionRegions(context);
    let redactedDataUrl;
    let redactionCount;
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
    const base64 = redactedDataUrl.replace(/^data:image\/\w+;base64,/, "");
    let serverResponse;
    try {
      serverResponse = await transmitToServer(request.serverUrl, {
        screenshot_b64: base64,
        dom_summary: buildDomSummary(context),
        task_goal: request.taskGoal,
        redacted_regions: regions,
        page_url: context.url
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
        summary: "Server unreachable. Check that the PS171 server is running.",
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
    let origin = "unknown";
    try {
      origin = new URL(context.url).origin;
    } catch {
      origin = "unknown";
    }
    const approvedActions = [];
    for (const action of serverResponse.actions) {
      const policyInput = {
        taskGoal: request.taskGoal,
        detectedData: [],
        pageTrust: 1,
        injectionRisk: 0,
        proposedAction: {
          id: crypto.randomUUID(),
          type: action.type,
          target: action.selector ? { elementId: action.selector } : void 0,
          value: action.value,
          origin
        },
        origin,
        userPolicy: userPolicy2
      };
      const result = evaluatePolicy(policyInput);
      audit({
        type: "ACTION",
        origin,
        decision: result.decision,
        summary: `Agent action ${action.type} \u2014 ${action.label}`,
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

  // extension/src/background/background.ts
  var POLICY_STORAGE_KEY = "ps171_user_policy";
  var SERVER_URL_KEY = "ps171_server_url";
  var DEFAULT_SERVER_URL = "http://localhost:3001";
  var contexts = /* @__PURE__ */ new Map();
  var defaultPolicy = {
    deniedOrigins: [],
    allowlistedOrigins: [],
    confirmMedium: false
  };
  var userPolicy = { ...defaultPolicy };
  var serverUrl = DEFAULT_SERVER_URL;
  async function loadSettings() {
    try {
      const result = await chrome.storage.local.get([
        POLICY_STORAGE_KEY,
        SERVER_URL_KEY
      ]);
      const stored = result[POLICY_STORAGE_KEY];
      if (stored && typeof stored === "object") {
        userPolicy = {
          deniedOrigins: Array.isArray(stored.deniedOrigins) ? stored.deniedOrigins : [],
          allowlistedOrigins: Array.isArray(stored.allowlistedOrigins) ? stored.allowlistedOrigins : [],
          confirmMedium: typeof stored.confirmMedium === "boolean" ? stored.confirmMedium : false
        };
      }
      if (typeof result[SERVER_URL_KEY] === "string") {
        serverUrl = result[SERVER_URL_KEY];
      }
    } catch {
    }
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
      if (POLICY_STORAGE_KEY in changes) void loadSettings();
      if (SERVER_URL_KEY in changes) void loadSettings();
    }
  });
  void loadSettings();
  async function handleContext(context, tabId) {
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
        void handleContext(request.context, tabId).then(sendResponse).catch((err) => {
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
      if (request.type === "PS171_GET_STATUS") {
        const record = tabId === void 0 ? void 0 : contexts.get(tabId);
        void getAuditEvents().then((auditEvents) => {
          sendResponse(
            record ? { context: record.context, policy: record.policy, sanitized: record.sanitized, audit: auditEvents, serverUrl } : { audit: auditEvents, serverUrl }
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
      if (request.type === "PS171_SAVE_SERVER_URL" && typeof request.url === "string") {
        serverUrl = request.url;
        void chrome.storage.local.set({ [SERVER_URL_KEY]: serverUrl });
        sendResponse({ ok: true });
        return false;
      }
      if (request.type === "PS171_RUN_AGENT" && request.agentRequest && tabId !== void 0) {
        const agentRequest = {
          ...request.agentRequest,
          serverUrl: request.agentRequest.serverUrl || serverUrl
        };
        const record = contexts.get(tabId);
        if (!record) {
          sendResponse({ stage: "ERROR", error: "No page context \u2014 open a web page first.", actions: [], redactionCount: 0, latencyMs: 0, summary: "" });
          return false;
        }
        void runAgentPipeline({ request: agentRequest, context: record.context, userPolicy }).then(sendResponse).catch((err) => {
          sendResponse({ stage: "ERROR", error: err instanceof Error ? err.message : "Pipeline failed", actions: [], redactionCount: 0, latencyMs: 0, summary: "" });
        });
        return true;
      }
      if (request.type === "PS171_EXECUTE_ACTIONS" && Array.isArray(request.agentActions) && tabId !== void 0) {
        const actions = request.agentActions;
        const results = [];
        (async () => {
          for (let i = 0; i < actions.length; i++) {
            try {
              const result = await chrome.tabs.sendMessage(tabId, {
                type: "PS171_EXECUTE_ACTION",
                action: actions[i],
                index: i
              });
              results.push(result);
              if (i < actions.length - 1) await new Promise((r) => setTimeout(r, 600));
            } catch (err) {
              results.push({ actionIndex: i, success: false, error: err instanceof Error ? err.message : "failed" });
            }
          }
          sendResponse({ results });
        })();
        return true;
      }
      return false;
    }
  );
})();
//# sourceMappingURL=background.js.map
