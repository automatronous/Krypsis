# Threat model

Assets include credentials, PII, tokens, user intent, proposed browser actions, extension permissions, model assets, and audit records. Main threats are malicious page instructions, iframe/cross-origin content, prompt injection, agent-driven disclosure, overbroad permissions, tampered model files, and secrets in logs.

Controls are least-necessary context, deterministic redaction, origin policy, high-risk action confirmation/blocking, no direct model execution, bounded local collection, audit evidence without raw values, and safe failure when the model or browser capability is unavailable. This is not a guarantee of complete security or detection.
