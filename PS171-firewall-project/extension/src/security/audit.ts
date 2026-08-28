import type { AuditEvent } from "../types/domain";

const STORAGE_KEY = "ps171_audit";
const MAX_EVENTS = 100;

// In-memory ring buffer (populated on first access from storage)
const events: AuditEvent[] = [];
let loaded = false;

/**
 * Load persisted events from chrome.storage.local into the in-memory buffer.
 * Called once on first use so the service worker recovers state after sleeping.
 */
async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const stored: AuditEvent[] = Array.isArray(result[STORAGE_KEY])
      ? (result[STORAGE_KEY] as AuditEvent[])
      : [];
    events.push(...stored.slice(-MAX_EVENTS));
  } catch {
    // Storage unavailable — continue with in-memory only
  }
}

/**
 * Persist current events array to chrome.storage.local.
 */
function persist(): void {
  try {
    void chrome.storage.local.set({ [STORAGE_KEY]: events.slice(-MAX_EVENTS) });
  } catch {
    // Ignore storage errors — audit is best-effort
  }
}

export function audit(event: Omit<AuditEvent, "id" | "timestamp">): AuditEvent {
  const safe: AuditEvent = {
    ...event,
    evidence: event.evidence.map((item) => item.slice(0, 240)),
    id: crypto.randomUUID(),
    timestamp: Date.now()
  };
  events.push(safe);
  if (events.length > MAX_EVENTS) events.shift();
  persist();
  return safe;
}

export async function getAuditEvents(): Promise<AuditEvent[]> {
  await ensureLoaded();
  return events.map((event) => ({ ...event, evidence: [...event.evidence] }));
}
