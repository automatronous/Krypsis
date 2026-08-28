"use strict";
(() => {
  // extension/src/popup/options.ts
  var POLICY_STORAGE_KEY = "ps171_user_policy";
  var AUDIT_STORAGE_KEY = "ps171_audit";
  function el(id) {
    return document.getElementById(id);
  }
  function showStatus(msg, isError = false) {
    const node = el("status");
    node.textContent = msg;
    node.className = isError ? "status error" : "status";
    setTimeout(() => {
      node.textContent = "";
    }, 3200);
  }
  async function loadPolicy() {
    const result = await chrome.storage.local.get(POLICY_STORAGE_KEY);
    const policy = result[POLICY_STORAGE_KEY];
    if (!policy) return;
    const toggle = el("confirmMedium");
    toggle.checked = policy.confirmMedium ?? false;
    toggle.setAttribute("aria-checked", String(toggle.checked));
    el("deniedOrigins").value = (policy.deniedOrigins ?? []).join("\n");
    el("allowlistedOrigins").value = (policy.allowlistedOrigins ?? []).join("\n");
  }
  function readPolicy() {
    const parseLines = (id) => el(id).value.split("\n").map((s) => s.trim()).filter((s) => s.length > 0 && s.startsWith("http"));
    return {
      confirmMedium: el("confirmMedium").checked,
      deniedOrigins: parseLines("deniedOrigins"),
      allowlistedOrigins: parseLines("allowlistedOrigins")
    };
  }
  async function savePolicy() {
    const policy = readPolicy();
    await chrome.storage.local.set({ [POLICY_STORAGE_KEY]: policy });
    try {
      await chrome.runtime.sendMessage({ type: "PS171_SAVE_POLICY", policy });
    } catch {
    }
    showStatus("\u2713 Settings saved");
  }
  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }
  function renderAuditRow(event) {
    const dec = event.decision ?? "\u2014";
    const cls = ["ALLOW", "BLOCK", "CONFIRM", "SANITIZE"].includes(dec) ? dec : "";
    return `
    <div class="audit-entry">
      <span class="audit-time">${formatTime(event.timestamp)}</span>
      <span class="audit-summary">${escapeHtml(event.summary)}</span>
      <span class="audit-decision ${cls}">${escapeHtml(dec)}</span>
    </div>`;
  }
  function escapeHtml(s) {
    return s.replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c
    );
  }
  async function loadAuditLog() {
    const container = el("auditLog");
    container.innerHTML = `<p class="loading">Loading\u2026</p>`;
    const result = await chrome.storage.local.get(AUDIT_STORAGE_KEY);
    const events = Array.isArray(result[AUDIT_STORAGE_KEY]) ? result[AUDIT_STORAGE_KEY] : [];
    if (events.length === 0) {
      container.innerHTML = `<p class="loading">No audit events yet. Browse a page to begin.</p>`;
      return;
    }
    container.innerHTML = [...events].reverse().map(renderAuditRow).join("");
  }
  async function clearAuditLog() {
    if (!confirm("Clear all audit log entries? This cannot be undone.")) return;
    await chrome.storage.local.remove(AUDIT_STORAGE_KEY);
    showStatus("Audit log cleared");
    void loadAuditLog();
  }
  async function exportAuditLog() {
    const result = await chrome.storage.local.get(AUDIT_STORAGE_KEY);
    const events = result[AUDIT_STORAGE_KEY] ?? [];
    const blob = new Blob([JSON.stringify(events, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ps171-audit-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function wireSwitchAria() {
    const toggle = el("confirmMedium");
    toggle.addEventListener("change", () => {
      toggle.setAttribute("aria-checked", String(toggle.checked));
    });
  }
  void (async () => {
    await loadPolicy();
    await loadAuditLog();
    wireSwitchAria();
    el("save").addEventListener("click", () => void savePolicy());
    el("refreshAudit").addEventListener("click", () => void loadAuditLog());
    el("clearAudit").addEventListener("click", () => void clearAuditLog());
    el("exportAudit").addEventListener("click", () => void exportAuditLog());
  })();
})();
//# sourceMappingURL=options.js.map
