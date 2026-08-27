# Security notes

Page content is always untrusted. The injection detector supplies evidence and risk; it never becomes the policy authority. Passwords, card candidates, and auth tokens are sanitized by default. Payments, transfers, deletion, and other critical actions are blocked by default; external communication requires confirmation.

The MVP requests `<all_urls>` only to support its demonstration sensor. A production store submission should narrow matches to the user’s chosen sites and document the permission rationale.
