"use strict";
(() => {
  // extension/src/popup/popup.ts
  function metric(label, value) {
    return `<div class="metric"><b>${String(value)}</b><small>${label}</small></div>`;
  }
  function safe(value) {
    return value.replace(
      /[&<>"']/g,
      (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char
    );
  }
  function renderRiskBar(risk) {
    const bar = document.getElementById("riskBar");
    const label = document.getElementById("riskLabel");
    const pct = Math.round(risk * 100);
    bar.style.width = `${pct}%`;
    bar.style.backgroundPosition = `${100 - pct}% 0`;
    label.textContent = `${pct}% risk`;
    label.style.color = pct >= 75 ? "#ff8590" : pct >= 40 ? "#ffd37a" : "#78d6b0";
  }
  function renderStateBadge(decision) {
    const state = document.querySelector("#state");
    const title = document.querySelector("#decisionTitle");
    state.className = "state";
    if (decision === "BLOCK") {
      state.textContent = "BLOCKED";
      state.classList.add("danger");
      title.textContent = "Blocked";
      title.style.color = "#ff8590";
    } else if (decision === "CONFIRM") {
      state.textContent = "CONFIRM";
      state.classList.add("warn");
      title.textContent = "Confirm Required";
      title.style.color = "#ffd37a";
    } else if (decision === "SANITIZE") {
      state.textContent = "SANITIZED";
      title.textContent = "Sanitized";
      title.style.color = "#7899dc";
    } else {
      state.textContent = "PROTECTED";
      title.textContent = "Protected";
      title.style.color = "#78d6b0";
    }
  }
  function renderPIIBadges(detections) {
    const container = document.getElementById("piiBadges");
    if (!detections.length) {
      container.innerHTML = `<span class="no-data">No PII detected on this page.</span>`;
      return;
    }
    const counts = {};
    for (const d of detections) counts[d.type] = (counts[d.type] ?? 0) + 1;
    container.innerHTML = Object.entries(counts).map(
      ([type, n]) => `<span class="pii-badge">${safe(type)}<span class="count">${n}</span></span>`
    ).join("");
  }
  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }
  function renderAuditLog(events) {
    const container = document.getElementById("auditLog");
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
  async function render() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.id) return;
    let context;
    try {
      context = await chrome.tabs.sendMessage(
        tab.id,
        "PS171_GET_CONTEXT"
      );
    } catch {
    }
    const response = await chrome.runtime.sendMessage({
      type: "PS171_GET_STATUS",
      tabId: tab.id
    });
    const ctx = response.context ?? context;
    const policy = response.policy ?? {
      decision: "ALLOW",
      reasons: ["No status yet \u2014 browse a page to begin scanning."],
      evidence: [],
      risk: 0
    };
    const detections = response.sanitized?.detections ?? [];
    const auditEvents = response.audit ?? [];
    renderStateBadge(policy.decision);
    renderRiskBar(policy.risk);
    renderPIIBadges(detections);
    if (ctx) {
      document.getElementById("sensor").innerHTML = [
        metric("visible chars", ctx.pageText.length),
        metric("forms", ctx.forms.length),
        metric("password fields", ctx.elements.filter((e) => e.type === "password").length),
        metric("buttons", ctx.elements.filter((e) => e.tag === "button").length),
        metric("links", ctx.elements.filter((e) => e.tag === "a").length),
        metric("iframes", ctx.iframes.length),
        metric("mutations", ctx.mutationCount),
        metric("sensitive", ctx.elements.filter((e) => e.sensitive).length)
      ].join("");
    } else {
      document.getElementById("sensor").innerHTML = `<span style="color:#7184a7;font-size:12px;grid-column:1/-1">No page context \u2014 open a web page first.</span>`;
    }
    document.getElementById("decision").innerHTML = `<div class="decision">${safe(policy.decision)}</div><div class="reason">${safe(policy.reasons.join(" "))}</div>`;
    document.getElementById("evidence").innerHTML = policy.evidence.length ? policy.evidence.map((item) => `<div><b>${safe(item.rule)}</b> \u2014 ${safe(item.detail)}</div>`).join("") : "No restriction evidence.";
    renderAuditLog(auditEvents);
    document.getElementById("performance").innerHTML = [
      metric("last inference", "DOM + rules"),
      metric("backend", "WASM fallback ready"),
      metric("model", "not loaded"),
      metric("network", "local only")
    ].join("");
  }
  document.getElementById("settingsBtn")?.addEventListener("click", () => {
    void chrome.runtime.openOptionsPage();
  });
  void render().catch((error) => {
    const node = document.getElementById("decision");
    if (node)
      node.textContent = error instanceof Error ? error.message : "Unable to read local page status.";
  });
})();
//# sourceMappingURL=popup.js.map
