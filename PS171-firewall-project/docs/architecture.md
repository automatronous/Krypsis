# PS171 architecture

PS171 is a local-first firewall between browser context and an agent. The content script collects a bounded, structured `PageContext`; the service worker evaluates untrusted page text, sanitizes context, and logs decisions. Proposed actions use a typed taxonomy and are evaluated by the same deterministic policy engine before any executor is allowed to run.

The normal route is DOM → deterministic rules → optional lightweight text model → selective visual fallback → policy → allow/sanitize/confirm/block. Raw HTML, password values, screenshots, and unredacted page text are not audit payloads.
