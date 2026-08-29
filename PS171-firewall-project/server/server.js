/**
 * PS171 Privacy Vision Agent — Server
 * ------------------------------------
 * Receives a privacy-redacted screenshot + DOM summary from the browser extension,
 * processes it via OpenRouter (multimodal vision support),
 * and returns structured browser actions.
 *
 * Endpoint: POST /analyze
 * Health:   GET  /health
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
const PORT = parseInt(process.env.PORT ?? "3001", 10);

// ---- Middleware ----
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "20mb" }));

// ---- OpenRouter setup ----
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("❌ OPENAI_API_KEY is not set in server/.env");
  process.exit(1);
}

const openai = new OpenAI({
  apiKey,
  baseURL: process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "http://localhost:3001",
    "X-Title": "PS171 Privacy Vision Agent"
  }
});

const MODEL_NAMES = [
  process.env.OPENAI_MODEL || "google/gemma-4-27b-it:free",
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "minimax/minimax-m3:free",
  "openrouter/free"
];

// ---- Build prompt ----
function buildPrompt(taskGoal, domSummary, redactedRegions, pageUrl) {
  const regionSummary = redactedRegions.length === 0
    ? "No regions were redacted."
    : redactedRegions.map((r) => `• ${r.reason} at (${r.x}, ${r.y}) size ${r.width}×${r.height} — redaction: ${r.redactionType}`).join("\n");

  const interactables = (domSummary.interactables ?? [])
    .slice(0, 40)
    .map((el) => {
      const desc = [el.ariaLabel, el.placeholder, el.text].filter(Boolean).join(" / ").slice(0, 60);
      return `  id="${el.id}" tag=${el.tag} type=${el.type ?? "—"} label="${desc}" name="${el.name ?? ""}"`;
    })
    .join("\n");

  return `You are a browser automation assistant analyzing a privacy-redacted web page screenshot.

PAGE: ${pageUrl}
TITLE: ${domSummary.title ?? "unknown"}
USER TASK: "${taskGoal}"

PRIVACY REDACTIONS APPLIED:
${regionSummary}
The above areas contain sensitive data (passwords, financial info, face images) and have been visually obscured before transmission. Do NOT ask for or reference the content of those areas.

DOM INTERACTABLE ELEMENTS (for selector guidance):
${interactables || "None found."}

INSTRUCTIONS:
1. Look at the screenshot carefully. Identify what is visible and relevant to the task.
2. Determine the minimal sequence of browser actions needed to complete the task.
3. For each action, use the most specific CSS selector available from the DOM list above.
4. Prefer id-based selectors (e.g., #submit-btn) over generic ones.
5. Set confidence between 0 and 1 based on how certain you are.
6. If the task cannot be safely completed (ambiguous, risky, or target not visible), return an empty actions array and explain in summary.
7. Do NOT generate actions that would access, reveal, or transmit the redacted sensitive data.

Return ONLY a valid JSON object matching this exact schema (supported types: CLICK, TYPE, SCROLL, NAVIGATE, SUBMIT, INJECT_STYLE):
{
  "actions": [
    {
      "type": "CLICK",
      "selector": "#element-id",
      "value": "optional string if TYPE",
      "label": "human readable description",
      "confidence": 0.95
    }
  ],
  "summary": "Explanation of planned actions",
  "requires_confirmation": false
}`;
}

// ---- POST /analyze ----
app.post("/analyze", async (req, res) => {
  const { screenshot_b64, dom_summary, task_goal, redacted_regions, page_url } = req.body;

  if (!task_goal) {
    return res.status(400).json({ error: "task_goal is required" });
  }

  const started = Date.now();

  try {
    const promptText = buildPrompt(task_goal, dom_summary ?? {}, redacted_regions ?? [], page_url ?? "unknown");
    const dataUrl = screenshot_b64
      ? (screenshot_b64.startsWith("data:") ? screenshot_b64 : `data:image/png;base64,${screenshot_b64}`)
      : null;

    let response;
    let lastErr;

    for (const modelName of MODEL_NAMES) {
      try {
        const userContent = [{ type: "text", text: promptText }];
        if (dataUrl) {
          userContent.push({ type: "image_url", image_url: { url: dataUrl } });
        }

        response = await openai.chat.completions.create({
          model: modelName,
          messages: [
            {
              role: "user",
              content: userContent
            }
          ],
          response_format: { type: "json_object" },
          temperature: 0.1,
          max_tokens: 2048
        });
        break;
      } catch (err) {
        lastErr = err;
        console.warn(`Model ${modelName} failed (${err?.message}), trying fallback...`);
      }
    }

    if (!response) {
      throw lastErr || new Error("All OpenRouter VLM model fallbacks failed");
    }

    let content = response.choices[0]?.message?.content ?? "";

    // Strip markdown code fences if present
    content = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Attempt to auto-repair truncated JSON
      let repaired = content;
      // Close open string if cut off mid-sentence
      if ((repaired.match(/"/g) || []).length % 2 !== 0) {
        repaired += '"';
      }
      // Balance unclosed braces/brackets
      const openBraces = (repaired.match(/\{/g) || []).length - (repaired.match(/\}/g) || []).length;
      const openBrackets = (repaired.match(/\[/g) || []).length - (repaired.match(/\]/g) || []).length;
      repaired += "]".repeat(Math.max(0, openBrackets)) + "}".repeat(Math.max(0, openBraces));

      try {
        parsed = JSON.parse(repaired);
        console.log("⚠️ Successfully repaired truncated JSON response");
      } catch {
        console.error("Failed to parse VLM response:", content.slice(0, 300));
        return res.status(500).json({ error: "Model returned invalid JSON", raw: content.slice(0, 300) });
      }
    }

    const latencyMs = Date.now() - started;
    console.log(`✓ /analyze — ${parsed.actions?.length ?? 0} actions — ${latencyMs}ms — "${task_goal.slice(0, 60)}"`);

    return res.json({
      actions: parsed.actions ?? [],
      summary: parsed.summary ?? "",
      requires_confirmation: parsed.requires_confirmation ?? true,
      latency_ms: latencyMs
    });
  } catch (err) {
    console.error("OpenRouter API error:", err?.message ?? err);
    return res.status(500).json({
      error: err?.message ?? "Internal server error",
      actions: [],
      summary: "The OpenRouter VLM failed to process the request."
    });
  }
});

// ---- GET /health ----
app.get("/health", (_req, res) => {
  res.json({ status: "ok", provider: "openrouter-api", timestamp: Date.now() });
});

// ---- Start ----
app.listen(PORT, () => {
  console.log(`
  ██████╗ ███████╗ ██╗███████╗ ██╗
  ██╔══██╗██╔════╝███║╚════██║ ╚═╝
  ██████╔╝███████╗╚██║    ██╔╝    
  ██╔═══╝ ╚════██║ ██║   ██╔╝     
  ██║     ███████║ ██║   ██║      
  ╚═╝     ╚══════╝ ╚═╝   ╚═╝  SERVER

  Privacy Vision Agent — Server Side
  Provider: OpenRouter API (openrouter.ai)
  
  → http://localhost:${PORT}/health
  → POST http://localhost:${PORT}/analyze
  `);
});
