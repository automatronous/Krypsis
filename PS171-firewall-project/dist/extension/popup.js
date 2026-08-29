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
  function renderRiskBar(risk) {
    const pct = Math.round(risk * 100);
    el("riskBar").style.width = `${pct}%`;
    const label = el("riskLabel");
    label.textContent = `${pct}% risk`;
    label.style.color = pct >= 75 ? "#ff8590" : pct >= 40 ? "#ffd37a" : "#78d6b0";
  }
  function renderStateBadge(decision) {
    const state = el("state");
    const title = el("decisionTitle");
    state.className = "state";
    const map = {
      BLOCK: ["BLOCKED", "danger", "#ff8590"],
      CONFIRM: ["CONFIRM", "warn", "#ffd37a"],
      SANITIZE: ["SANITIZED", "", "#7899dc"],
      ALLOW: ["PROTECTED", "", "#78d6b0"]
    };
    const entry = map[decision] ?? ["PROTECTED", "", "#78d6b0"];
    const label = entry[0];
    const cls = entry[1];
    const color = entry[2];
    state.textContent = label;
    if (cls) state.classList.add(cls);
    title.textContent = label.charAt(0) + label.slice(1).toLowerCase();
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
})();
//# sourceMappingURL=popup.js.map
