/**
 * PS171 Privacy Vision Agent — Server
 * ------------------------------------
 * Receives a privacy-redacted screenshot + DOM summary from the browser extension,
 * processes it via Gemini 1.5 Flash (multimodal), and returns structured browser actions.
 *
 * Endpoint: POST /analyze
 * Health:   GET  /health
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

const app = express();
const PORT = parseInt(process.env.PORT ?? "3001", 10);

// ---- Middleware ----
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "20mb" })); // screenshots can be large

// ---- Gemini setup ----
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("❌ GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.");
  process.exit(1);
}
const genai = new GoogleGenerativeAI(apiKey);

// Structured output schema for reliable JSON parsing
const actionSchema = {
  type: SchemaType.OBJECT,
  properties: {
    actions: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          type: { type: SchemaType.STRING, enum: ["CLICK", "TYPE", "SCROLL", "NAVIGATE", "SUBMIT"] },
          selector: { type: SchemaType.STRING, nullable: true },
          value: { type: SchemaType.STRING, nullable: true },
          label: { type: SchemaType.STRING },
          confidence: { type: SchemaType.NUMBER },
          scrollY: { type: SchemaType.NUMBER, nullable: true },
          url: { type: SchemaType.STRING, nullable: true }
        },
        required: ["type", "label", "confidence"]
      }
    },
    summary: { type: SchemaType.STRING },
    requires_confirmation: { type: SchemaType.BOOLEAN }
  },
  required: ["actions", "summary", "requires_confirmation"]
};

// Primary and fallback models
const MODEL_NAMES = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash-latest"];
let currentModelName = MODEL_NAMES[0];

function getModel(modelName = currentModelName) {
  return genai.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: actionSchema,
      temperature: 0.1,
      maxOutputTokens: 1024
    }
  });
}

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

Return only the structured JSON.`;
}

// ---- POST /analyze ----
app.post("/analyze", async (req, res) => {
  const { screenshot_b64, dom_summary, task_goal, redacted_regions, page_url } = req.body;

  if (!screenshot_b64 || !task_goal) {
    return res.status(400).json({ error: "screenshot_b64 and task_goal are required" });
  }

  const started = Date.now();

  try {
    const prompt = buildPrompt(task_goal, dom_summary ?? {}, redacted_regions ?? [], page_url ?? "unknown");

    const imagePart = {
      inlineData: {
        data: screenshot_b64,
        mimeType: "image/png"
      }
    };

    let result;
    let text;
    let lastErr;

    for (const name of MODEL_NAMES) {
      try {
        const modelInst = getModel(name);
        result = await modelInst.generateContent([prompt, imagePart]);
        text = result.response.text();
        currentModelName = name;
        break;
      } catch (err) {
        lastErr = err;
        if (err?.message?.includes("404")) {
          console.warn(`Model ${name} not found, trying fallback...`);
          continue;
        }
        throw err;
      }
    }

    if (!text) {
      throw lastErr || new Error("All model fallback attempts failed");
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      console.error("Failed to parse Gemini response:", text.slice(0, 300));
      return res.status(500).json({ error: "Model returned invalid JSON", raw: text.slice(0, 300) });
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
    console.error("Gemini error:", err?.message ?? err);
    return res.status(500).json({
      error: err?.message ?? "Internal server error",
      actions: [],
      summary: "The VLM failed to process the request."
    });
  }
});

// ---- GET /health ----
app.get("/health", (_req, res) => {
  res.json({ status: "ok", model: "gemini-1.5-flash", timestamp: Date.now() });
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
  VLM: gemini-1.5-flash
  
  → http://localhost:${PORT}/health
  → POST http://localhost:${PORT}/analyze
  `);
});
