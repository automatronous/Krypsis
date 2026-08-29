import type { AuditEvent, UserPolicy } from "../types/domain";

const POLICY_STORAGE_KEY = "ps171_user_policy";
const AUDIT_STORAGE_KEY = "ps171_audit";
const SERVER_URL_KEY = "ps171_server_url";
const DEFAULT_SERVER_URL = "http://localhost:3001";

// --- Element helpers ---
function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
function showStatus(msg: string, isError = false): void {
  const node = el<HTMLElement>("status");
  node.textContent = msg;
  node.className = isError ? "status error" : "status";
  setTimeout(() => { node.textContent = ""; }, 3200);
}

// --- Policy ---
async function loadPolicy(): Promise<void> {
  const result = await chrome.storage.local.get([POLICY_STORAGE_KEY, SERVER_URL_KEY]);
  const policy = result[POLICY_STORAGE_KEY] as UserPolicy | undefined;
  if (policy) {
    const toggle = el<HTMLInputElement>("confirmMedium");
    toggle.checked = policy.confirmMedium ?? false;
    toggle.setAttribute("aria-checked", String(toggle.checked));
    el<HTMLTextAreaElement>("deniedOrigins").value = (policy.deniedOrigins ?? []).join("\n");
    el<HTMLTextAreaElement>("allowlistedOrigins").value = (policy.allowlistedOrigins ?? []).join("\n");
  }
  const urlField = document.getElementById("serverUrl") as HTMLInputElement | null;
  if (urlField) {
    urlField.value = typeof result[SERVER_URL_KEY] === "string"
      ? (result[SERVER_URL_KEY] as string)
      : DEFAULT_SERVER_URL;
  }
}

function readPolicy(): UserPolicy {
  const parseLines = (id: string): string[] =>
    el<HTMLTextAreaElement>(id)
      .value.split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.startsWith("http"));
  return {
    confirmMedium: el<HTMLInputElement>("confirmMedium").checked,
    deniedOrigins: parseLines("deniedOrigins"),
    allowlistedOrigins: parseLines("allowlistedOrigins")
  };
}

async function savePolicy(): Promise<void> {
  const policy = readPolicy();
  await chrome.storage.local.set({ [POLICY_STORAGE_KEY]: policy });
  // Save server URL
  const urlField = document.getElementById("serverUrl") as HTMLInputElement | null;
  if (urlField?.value) {
    const newUrl = urlField.value.trim() || DEFAULT_SERVER_URL;
    await chrome.storage.local.set({ [SERVER_URL_KEY]: newUrl });
    try {
      await chrome.runtime.sendMessage({ type: "PS171_SAVE_SERVER_URL", url: newUrl });
    } catch { /* service worker may be sleeping */ }
  }
  try {
    await chrome.runtime.sendMessage({ type: "PS171_SAVE_POLICY", policy });
  } catch {
    // Service worker may be sleeping — storage update is sufficient
  }
  showStatus("✓ Settings saved");
}

// --- Audit log ---
function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function renderAuditRow(event: AuditEvent): string {
  const dec = event.decision ?? "—";
  const cls = ["ALLOW", "BLOCK", "CONFIRM", "SANITIZE"].includes(dec)
    ? dec
    : "";
  return `
    <div class="audit-entry">
      <span class="audit-time">${formatTime(event.timestamp)}</span>
      <span class="audit-summary">${escapeHtml(event.summary)}</span>
      <span class="audit-decision ${cls}">${escapeHtml(dec)}</span>
    </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ] ?? c)
  );
}

async function loadAuditLog(): Promise<void> {
  const container = el<HTMLElement>("auditLog");
  container.innerHTML = `<p class="loading">Loading…</p>`;
  const result = await chrome.storage.local.get(AUDIT_STORAGE_KEY);
  const events: AuditEvent[] = Array.isArray(result[AUDIT_STORAGE_KEY])
    ? (result[AUDIT_STORAGE_KEY] as AuditEvent[])
    : [];
  if (events.length === 0) {
    container.innerHTML = `<p class="loading">No audit events yet. Browse a page to begin.</p>`;
    return;
  }
  container.innerHTML = [...events].reverse().map(renderAuditRow).join("");
}

async function clearAuditLog(): Promise<void> {
  if (!confirm("Clear all audit log entries? This cannot be undone.")) return;
  await chrome.storage.local.remove(AUDIT_STORAGE_KEY);
  showStatus("Audit log cleared");
  void loadAuditLog();
}

async function exportAuditLog(): Promise<void> {
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

// --- Toggle ARIA sync ---
function wireSwitchAria(): void {
  const toggle = el<HTMLInputElement>("confirmMedium");
  toggle.addEventListener("change", () => {
    toggle.setAttribute("aria-checked", String(toggle.checked));
  });
}

// --- Bootstrap ---
void (async () => {
  await loadPolicy();
  await loadAuditLog();
  wireSwitchAria();
  el("save").addEventListener("click", () => void savePolicy());
  el("refreshAudit").addEventListener("click", () => void loadAuditLog());
  el("clearAudit").addEventListener("click", () => void clearAuditLog());
  el("exportAudit").addEventListener("click", () => void exportAuditLog());
})();
