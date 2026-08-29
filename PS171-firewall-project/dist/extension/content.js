"use strict";
(() => {
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
  function detectElement(element) {
    const labels = [
      element.type,
      element.name,
      element.placeholder,
      element.ariaLabel,
      Object.values(element.attributes).join(" ")
    ].filter(Boolean).join(" ").toLowerCase();
    const result = [];
    const add = (type, confidence, reason) => result.push({
      id: `dom-${element.id}-${result.length + 1}`,
      type,
      source: "DOM",
      confidence,
      elementId: element.id,
      reason
    });
    if (element.type?.toLowerCase() === "password" || /password|passcode/.test(labels))
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

  // extension/src/browser/collector.ts
  function rectOf(element) {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }
  function isVisible(element) {
    const html = element;
    const style = typeof getComputedStyle === "function" ? getComputedStyle(html) : void 0;
    const rect = html.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && style?.display !== "none" && style?.visibility !== "hidden";
  }
  function attributes(element) {
    return Object.fromEntries(
      Array.from(element.attributes).filter((a) => a.name !== "value").map((a) => [a.name, a.value])
    );
  }
  function collectPageContext() {
    const elements = Array.from(
      document.querySelectorAll(
        "button, a, input, textarea, select, [role], [contenteditable='true']"
      )
    ).map((element, index) => {
      const input = element;
      const id = element.id || `ps171-${index + 1}`;
      const elementData = {
        id,
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role") ?? void 0,
        text: (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 300) || void 0,
        type: input.type || void 0,
        ariaLabel: element.getAttribute("aria-label") ?? void 0,
        placeholder: input.placeholder || void 0,
        name: input.name || void 0,
        value: input.type === "password" ? void 0 : input.value || void 0,
        rect: rectOf(element),
        attributes: attributes(element),
        visible: isVisible(element),
        enabled: !input.disabled,
        sensitive: false
      };
      elementData.sensitive = detectElement(elementData).some(
        (d) => d.confidence >= 0.85
      );
      return elementData;
    });
    const forms = Array.from(document.forms).map((form, index) => ({
      id: form.id || `form-${index + 1}`,
      action: form.action,
      method: form.method || "get",
      fieldCount: form.elements.length,
      hasPassword: Boolean(form.querySelector("input[type=password]"))
    }));
    const iframes = Array.from(
      document.querySelectorAll("iframe")
    ).map((frame) => {
      let sameOrigin = false;
      try {
        void frame.contentDocument;
        sameOrigin = true;
      } catch (error) {
        sameOrigin = false;
      }
      let origin = "unknown";
      try {
        origin = new URL(frame.src || location.href).origin;
      } catch (error) {
        origin = "unknown";
      }
      return { src: frame.src, origin, sameOrigin };
    });
    return {
      url: location.href,
      title: document.title,
      pageText: (document.body?.innerText ?? "").slice(0, 2e4),
      elements,
      forms,
      iframes,
      changedRegions: [],
      screenshotRegions: [],
      timestamp: Date.now(),
      mutationCount: 0,
      devicePixelRatio: window.devicePixelRatio || 1,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    };
  }

  // extension/src/actions/executor.ts
  function findElement(selector) {
    try {
      const el = document.querySelector(selector);
      if (el) return el;
    } catch {
    }
    const byId = document.getElementById(selector);
    if (byId) return byId;
    const byName = document.querySelector(`[name="${selector}"]`);
    if (byName) return byName;
    const byAria = document.querySelector(`[aria-label="${selector}"]`);
    if (byAria) return byAria;
    return null;
  }
  function simulateInput(el, value) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  async function executeAction(action, index) {
    try {
      switch (action.type) {
        case "CLICK": {
          const el = action.selector ? findElement(action.selector) : null;
          if (!el) {
            return { actionIndex: index, type: "CLICK", selector: action.selector, success: false, error: "Element not found" };
          }
          el.focus();
          el.click();
          return { actionIndex: index, type: "CLICK", selector: action.selector, success: true };
        }
        case "TYPE": {
          const el = action.selector ? findElement(action.selector) : null;
          if (!el) {
            return { actionIndex: index, type: "TYPE", selector: action.selector, success: false, error: "Element not found" };
          }
          el.focus();
          simulateInput(el, action.value ?? "");
          return { actionIndex: index, type: "TYPE", selector: action.selector, success: true };
        }
        case "SCROLL": {
          const y = action.scrollY ?? 300;
          window.scrollBy({ top: y, behavior: "smooth" });
          return { actionIndex: index, type: "SCROLL", success: true };
        }
        case "NAVIGATE": {
          if (action.url) {
            window.location.href = action.url;
            return { actionIndex: index, type: "NAVIGATE", success: true };
          }
          return { actionIndex: index, type: "NAVIGATE", success: false, error: "No URL provided" };
        }
        case "SUBMIT": {
          const el = action.selector ? findElement(action.selector) : null;
          if (el) {
            const form = el.closest("form") ?? el;
            if (form && form instanceof HTMLFormElement) {
              form.requestSubmit();
              return { actionIndex: index, type: "SUBMIT", selector: action.selector, success: true };
            }
          }
          return { actionIndex: index, type: "SUBMIT", selector: action.selector, success: false, error: "Form not found" };
        }
        default:
          return { actionIndex: index, type: action.type, success: false, error: `Unsupported action type: ${action.type}` };
      }
    } catch (err) {
      return {
        actionIndex: index,
        type: action.type,
        selector: action.selector,
        success: false,
        error: err instanceof Error ? err.message : "Unknown execution error"
      };
    }
  }

  // extension/src/content/content.ts
  var mutationCount = 0;
  var timer;
  var report = async () => {
    const context = collectPageContext();
    context.mutationCount = mutationCount;
    await chrome.runtime.sendMessage({ type: "PS171_CONTEXT", context });
  };
  var observer = new MutationObserver(() => {
    mutationCount += 1;
    if (timer !== void 0) window.clearTimeout(timer);
    timer = window.setTimeout(() => void report(), 350);
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true
  });
  void report();
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message === "PS171_GET_CONTEXT") {
      sendResponse(collectPageContext());
      return false;
    }
    if (typeof message === "object" && message !== null && message.type === "PS171_EXECUTE_ACTION") {
      const { action, index } = message;
      void executeAction(action, index).then(sendResponse);
      return true;
    }
    return false;
  });
})();
//# sourceMappingURL=content.js.map
