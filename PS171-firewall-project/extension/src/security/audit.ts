import type { AuditEvent } from "../types/domain";
const events: AuditEvent[] = [];
export function audit(event: Omit<AuditEvent, "id" | "timestamp">): AuditEvent {
  const safe = {
    ...event,
    evidence: event.evidence.map((item) => item.slice(0, 240)),
    id: crypto.randomUUID(),
    timestamp: Date.now()
  };
  events.push(safe);
  if (events.length > 100) events.shift();
  return safe;
}
export function getAuditEvents(): AuditEvent[] {
  return events.map((event) => ({ ...event, evidence: [...event.evidence] }));
}
