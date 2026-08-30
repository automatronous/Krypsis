"use strict";
(() => {
  // extension/src/popup/popup.ts
  function el(id) {
    return document.getElementById(id);
  }
  function show(id) {
    el(id).classList.remove("hidden");
  }
  function hide(id) {
    el(id).classList.add("hidden");
  }
  function safe(s) {
    return s.replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c
    );
  }
  var STAGE_LABELS = {
    IDLE: "IDLE",
    CAPTURE: "CAPTURING\u2026",
    REDACT: "REDACTING\u2026",
    TRANSMIT: "SENDING\u2026",
    PLAN: "PLANNING\u2026",
    CONFIRM: "AWAITING CONFIRM",
    EXECUTE: "EXECUTING\u2026",
    DONE: "DONE",
    ERROR: "ERROR"
  };
  function setStage(stage) {
    const pill = el("pipelineStage");
    pill.textContent = STAGE_LABELS[stage];
    pill.className = `stage-pill stage-${stage.toLowerCase()}`;
  }
  var currentWaterRgb = { r: 16, g: 185, b: 129 };
  function getThreatColor(risk) {
    const pct = Math.round(risk * 100);
    if (pct >= 80) return { hex: "#ef4444", rgb: { r: 239, g: 68, b: 68 }, level: "CRITICAL THREAT", class: "danger" };
    if (pct >= 60) return { hex: "#f97316", rgb: { r: 249, g: 115, b: 22 }, level: "HIGH THREAT", class: "warn" };
    if (pct >= 30) return { hex: "#f59e0b", rgb: { r: 245, g: 158, b: 11 }, level: "MEDIUM RISK", class: "warn" };
    return { hex: "#10b981", rgb: { r: 16, g: 185, b: 129 }, level: "LOW RISK", class: "" };
  }
  function renderRiskBar(risk) {
    const pct = Math.round(risk * 100);
    const threat = getThreatColor(risk);
    currentWaterRgb = threat.rgb;
    const label = el("riskLabel");
    label.textContent = `${pct}% risk (${threat.level})`;
    label.style.color = threat.hex;
    const statusDot = el("statusDot");
    statusDot.className = `status-indicator ${threat.class}`;
    const dot = statusDot.querySelector(".dot");
    if (dot) {
      dot.style.background = threat.hex;
      dot.style.boxShadow = `0 0 8px ${threat.hex}`;
    }
  }
  function renderStateBadge(decision) {
    const title = el("decisionTitle");
    const map = {
      BLOCK: ["Blocked", "#ef4444"],
      CONFIRM: ["Confirmation Required", "#f59e0b"],
      SANITIZE: ["Sanitized", "#3b82f6"],
      ALLOW: ["Protected", "#10b981"]
    };
    const [label, color] = map[decision] ?? ["Protected", "#10b981"];
    title.textContent = label;
    title.style.color = color;
  }
  function renderPIIBadges(detections) {
    const container = el("piiBadges");
    if (!detections.length) {
      container.innerHTML = `<span class="no-data">No PII detected on this page.</span>`;
      return;
    }
    const counts = {};
    for (const d of detections) counts[d.type] = (counts[d.type] ?? 0) + 1;
    container.innerHTML = Object.entries(counts).map(([type, n]) => `<span class="pii-badge">${safe(type)}<span class="count">${n}</span></span>`).join("");
  }
  function metric(label, value) {
    return `<div class="metric"><b>${String(value)}</b><small>${label}</small></div>`;
  }
  function renderSensor(ctx) {
    if (!ctx) {
      el("sensor").innerHTML = `<span style="color:#7184a7;font-size:12px;grid-column:1/-1">Open a web page first.</span>`;
      return;
    }
    el("sensor").innerHTML = [
      metric("visible chars", ctx.pageText.length),
      metric("forms", ctx.forms.length),
      metric("passwords", ctx.elements.filter((e) => e.type === "password").length),
      metric("buttons", ctx.elements.filter((e) => e.tag === "button").length),
      metric("links", ctx.elements.filter((e) => e.tag === "a").length),
      metric("iframes", ctx.iframes.length),
      metric("mutations", ctx.mutationCount),
      metric("sensitive", ctx.elements.filter((e) => e.sensitive).length)
    ].join("");
  }
  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
  function renderAuditLog(events) {
    const container = el("auditLog");
    if (!events.length) {
      container.innerHTML = `<p class="no-audit">No recent activity.</p>`;
      return;
    }
    container.innerHTML = [...events].reverse().slice(0, 10).map((e) => {
      const dec = e.decision ?? "\u2014";
      const cls = ["ALLOW", "BLOCK", "CONFIRM", "SANITIZE"].includes(dec) ? dec : "";
      return `<div class="audit-entry">
      <span class="audit-time">${formatTime(e.timestamp)}</span>
      <span class="audit-summary">${safe(e.summary)}</span>
      <span class="audit-dec ${cls}">${safe(dec)}</span>
    </div>`;
    }).join("");
  }
  var pendingActions = [];
  function renderActionQueue(actions) {
    pendingActions = actions;
    if (!actions.length) {
      hide("actionQueue");
      return;
    }
    const list = el("actionList");
    list.innerHTML = actions.map((a, i) => `
    <div class="action-item" id="action-item-${i}">
      <span class="action-type-badge">${safe(a.type)}</span>
      <span class="action-label">${safe(a.label)}${a.selector ? ` <code style="font-size:10px;color:#7899dc">${safe(a.selector)}</code>` : ""}</span>
      <span class="action-conf">${Math.round(a.confidence * 100)}%</span>
    </div>`).join("");
    show("actionQueue");
    hide("executionResults");
  }
  async function executeAllActions() {
    if (!pendingActions.length) return;
    hide("actionQueue");
    setStage("EXECUTE");
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (!tabId) {
      setStage("ERROR");
      return;
    }
    const response = await chrome.runtime.sendMessage({
      type: "PS171_EXECUTE_ACTIONS",
      agentActions: pendingActions,
      tabId
    });
    const resultsEl = el("executionResults");
    resultsEl.innerHTML = (response.results ?? []).map((r, i) => `
    <div class="exec-row">
      <span class="${r.success ? "exec-ok" : "exec-err"}">${r.success ? "\u2713" : "\u2717"}</span>
      <span>${safe(pendingActions[i]?.label ?? r.type)}</span>
      ${!r.success && r.error ? `<span style="color:#ff8590;font-size:10px">${safe(r.error)}</span>` : ""}
    </div>`).join("");
    show("executionResults");
    setStage("DONE");
    pendingActions = [];
  }
  async function runAgent() {
    const taskGoal = el("taskGoal").value.trim();
    if (!taskGoal) {
      alert("Please enter a task goal first.");
      return;
    }
    const statusResp = await chrome.runtime.sendMessage({ type: "PS171_GET_STATUS" });
    const serverUrl = statusResp.serverUrl ?? "http://localhost:3001";
    hide("screenshotWrap");
    hide("agentSummary");
    hide("agentError");
    hide("actionQueue");
    hide("executionResults");
    setStage("CAPTURE");
    el("runAgent").disabled = true;
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (!tabId) {
      setStage("ERROR");
      el("runAgent").disabled = false;
      return;
    }
    try {
      const stageUpdater = setInterval(() => {
        const current = el("pipelineStage").className;
        if (current.includes("capture")) setStage("REDACT");
        else if (current.includes("redact")) setStage("TRANSMIT");
        else if (current.includes("transmit")) setStage("PLAN");
      }, 1800);
      const result = await chrome.runtime.sendMessage({
        type: "PS171_RUN_AGENT",
        agentRequest: { taskGoal, serverUrl },
        tabId
      });
      clearInterval(stageUpdater);
      const stage = result?.stage ?? "ERROR";
      setStage(stage);
      if (!result) {
        el("agentError").textContent = "Error: Background service worker did not respond. Try reloading the extension in chrome://extensions.";
        show("agentError");
        return;
      }
      if (result.redactedScreenshot) {
        el("screenshotPreview").src = result.redactedScreenshot;
        el("redactionBadge").textContent = `${result.redactionCount} region${result.redactionCount !== 1 ? "s" : ""} redacted`;
        show("screenshotWrap");
      }
      if (result.summary) {
        el("agentSummary").textContent = result.summary;
        show("agentSummary");
      }
      if (result.error) {
        el("agentError").textContent = `Error: ${result.error}`;
        show("agentError");
      }
      if (result.actions.length > 0) {
        renderActionQueue(result.actions);
      } else if (result.stage !== "ERROR") {
        el("agentSummary").textContent += "\n\nNo actions to execute.";
      }
      void refreshStatus();
    } catch (err) {
      setStage("ERROR");
      el("agentError").textContent = `Pipeline error: ${err instanceof Error ? err.message : "unknown"}`;
      show("agentError");
    } finally {
      el("runAgent").disabled = false;
    }
  }
  async function refreshStatus() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.id) return;
    let ctx;
    try {
      ctx = await chrome.tabs.sendMessage(tab.id, "PS171_GET_CONTEXT");
    } catch {
    }
    const response = await chrome.runtime.sendMessage({
      type: "PS171_GET_STATUS",
      tabId: tab.id
    });
    const context = response.context ?? ctx;
    const policy = response.policy ?? { decision: "ALLOW", reasons: ["Browse a page to begin."], evidence: [], risk: 0 };
    const detections = response.sanitized?.detections ?? [];
    const auditEvents = response.audit ?? [];
    renderStateBadge(policy.decision);
    renderRiskBar(policy.risk);
    renderPIIBadges(detections);
    renderSensor(context);
    el("decision").innerHTML = `<div class="decision">${safe(policy.decision)}</div><div class="reason">${safe(policy.reasons.join(" "))}</div>`;
    el("evidence").innerHTML = policy.evidence.length ? policy.evidence.map((e) => `<div><b>${safe(e.rule)}</b> \u2014 ${safe(e.detail)}</div>`).join("") : "No restriction evidence.";
    renderAuditLog(auditEvents);
    el("performance").innerHTML = [
      metric("capture", "chrome API"),
      metric("redaction", "canvas + DOM"),
      metric("model", context ? "DOM rules" : "\u2014"),
      metric("network", "local only")
    ].join("");
  }
  function openImageModal(src) {
    const modal = el("imageModal");
    const modalImg = el("modalImage");
    modalImg.src = src;
    show("imageModal");
  }
  function closeImageModal() {
    hide("imageModal");
  }
  el("settingsBtn").addEventListener("click", () => void chrome.runtime.openOptionsPage());
  el("runAgent").addEventListener("click", () => void runAgent());
  el("executeAll").addEventListener("click", () => void executeAllActions());
  el("cancelActions").addEventListener("click", () => {
    hide("actionQueue");
    pendingActions = [];
    setStage("IDLE");
  });
  el("toggleScreenshotBtn").addEventListener("click", () => {
    const src = el("screenshotPreview").src;
    if (src) openImageModal(src);
  });
  el("screenshotPreview").addEventListener("click", () => {
    const src = el("screenshotPreview").src;
    if (src) openImageModal(src);
  });
  el("closeModalBtn").addEventListener("click", closeImageModal);
  el("imageModal").addEventListener("click", (e) => {
    if (e.target === el("imageModal")) closeImageModal();
  });
  void refreshStatus();
  function initWaterSimulation() {
    const canvas = document.getElementById("waterCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.src = "water_refraction.png";
    let patternCanvas = null;
    let patternCtx = null;
    img.onload = () => {
      patternCanvas = document.createElement("canvas");
      patternCanvas.width = img.width;
      patternCanvas.height = img.height;
      patternCtx = patternCanvas.getContext("2d");
      if (!patternCtx) return;
      patternCtx.drawImage(img, 0, 0);
      const imgData = patternCtx.getImageData(0, 0, img.width, img.height);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        const brightness = (r + g + b) / 3;
        const causticIntensity = Math.pow(brightness / 255, 2.2);
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = Math.min(255, Math.floor(causticIntensity * 160));
      }
      patternCtx.putImageData(imgData, 0, 0);
      requestAnimationFrame(draw);
    };
    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);
    let time = 0;
    function draw() {
      time += 8e-3;
      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = "#06090e";
      ctx.fillRect(0, 0, w, h);
      if (patternCanvas) {
        ctx.save();
        const shiftX1 = Math.sin(time * 0.8) * 15;
        const shiftY1 = Math.cos(time * 0.6) * 12;
        ctx.globalAlpha = 0.28;
        ctx.drawImage(patternCanvas, shiftX1 - 20, shiftY1 - 20, w + 40, h + 40);
        const shiftX2 = Math.cos(time * 1.1) * 18;
        const shiftY2 = Math.sin(time * 0.9) * 15;
        ctx.globalAlpha = 0.18;
        ctx.drawImage(patternCanvas, shiftX2 - 20, shiftY2 - 20, w + 40, h + 40);
        ctx.globalCompositeOperation = "source-atop";
        ctx.fillStyle = `rgba(${currentWaterRgb.r}, ${currentWaterRgb.g}, ${currentWaterRgb.b}, 0.85)`;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
      requestAnimationFrame(draw);
    }
  }
  initWaterSimulation();
})();
//# sourceMappingURL=popup.js.map
