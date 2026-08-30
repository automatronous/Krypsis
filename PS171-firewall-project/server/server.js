/**
 * PS171 Privacy Vision Agent — Server
 * ------------------------------------
 * Receives a privacy-redacted screenshot + DOM summary from the browser extension,
 * processes it via Ollama (local, primary) or OpenRouter (cloud, fallback),
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

// ---- Ollama (local) client — OpenAI-compatible API ----
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";
const OLLAMA_VISION_MODEL = process.env.OLLAMA_MODEL || "llama3.2-vision:11b";

const ollamaClient = new OpenAI({
  apiKey: "ollama",  // Ollama doesn't require a real key
  baseURL: OLLAMA_BASE_URL
});

// ---- OpenRouter (cloud fallback) client ----
const apiKey = process.env.OPENAI_API_KEY;
const openrouterClient = apiKey ? new OpenAI({
  apiKey,
  baseURL: process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "http://localhost:3001",
    "X-Title": "Krypsis Privacy Vision Agent"
  }
}) : null;

const OPENROUTER_MODELS = [
  "openrouter/free",
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "inclusionai/ling-3.0-flash-fin:free",
  "minimax/minimax-m3:free"
];

// ---- Check if Ollama is running and has the vision model ----
async function isOllamaReady() {
  try {
    const resp = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(2000) });
    if (!resp.ok) return false;
    const data = await resp.json();
    const models = (data.models ?? []).map((m) => m.name);
    return models.some((m) => m.includes("moondream") || m.includes("vision") || m.includes("llava"));
  } catch {
    return false;
  }
}

// ---- Get best available local model ----
async function getLocalModel() {
  try {
    const resp = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(2000) });
    if (!resp.ok) return OLLAMA_VISION_MODEL;
    const data = await resp.json();
    const models = (data.models ?? []).map((m) => m.name);
    const visionModel = models.find((m) => m.includes("moondream") || m.includes("vision") || m.includes("llava"));
    return visionModel || OLLAMA_VISION_MODEL;
  } catch {
    return OLLAMA_VISION_MODEL;
  }
}

// ---- Build prompt ----
function buildPrompt(taskGoal, domSummary, redactedRegions, pageUrl) {
  const regionSummary = redactedRegions.length === 0
    ? "No regions were redacted."
    : redactedRegions.map((r) => `• ${r.reason} at (${r.x}, ${r.y}) size ${r.width}×${r.height} — redaction: ${r.redactionType}`).join("\n");

  const interactables = (domSummary.interactables ?? [])
    .slice(0, 100)
    .map((el) => {
      const desc = [el.ariaLabel, el.placeholder, el.text].filter(Boolean).join(" / ").slice(0, 80);
      return `  id="${el.id}" tag=${el.tag} type=${el.type ?? "—"} text="${desc}" name="${el.name ?? ""}"`;
    })
    .join("\n");

  return `Analyze this web page screenshot for task: "${taskGoal}"

DOM ELEMENTS:
${interactables || "None"}

Generate browser actions to achieve the task. Return JSON:
{
  "actions": [
    { "type": "CLICK", "selector": "#ps171-1", "label": "description", "confidence": 0.9 }
  ],
  "summary": "planned actions"
}`;
}

// ---- Try Ollama local model ----
async function tryOllama(promptText, dataUrl) {
  const localModel = await getLocalModel();
  console.log(`🦙 Trying Ollama local model: ${localModel}`);

  const userContent = [{ type: "text", text: promptText }];
  if (dataUrl) {
    userContent.push({ type: "image_url", image_url: { url: dataUrl } });
  }

  const response = await ollamaClient.chat.completions.create(
    {
      model: localModel,
      messages: [{ role: "user", content: userContent }],
      temperature: 0.1,
      max_tokens: 2048
    },
    { timeout: 60000 }
  );
  console.log(`✓ Ollama local model succeeded using: ${localModel}`);
  return response;
}

// ---- Try OpenRouter cloud fallback ----
async function tryOpenRouter(promptText, dataUrl) {
  if (!openrouterClient) throw new Error("OpenRouter API key not configured");
  let lastErr;
  for (const modelName of OPENROUTER_MODELS) {
    try {
      const userContent = [{ type: "text", text: promptText }];
      if (dataUrl) {
        userContent.push({ type: "image_url", image_url: { url: dataUrl } });
      }
      const response = await openrouterClient.chat.completions.create(
        {
          model: modelName,
          messages: [{ role: "user", content: userContent }],
          temperature: 0.1,
          max_tokens: 2048
        },
        { timeout: 20000 }
      );
      console.log(`✓ OpenRouter fallback succeeded using: ${modelName}`);
      return response;
    } catch (err) {
      lastErr = err;
      console.warn(`OpenRouter model ${modelName} failed (${err?.message}), trying next...`);
    }
  }
  throw lastErr || new Error("All OpenRouter fallback models failed");
}

// ---- Parse model content to JSON ----
function parseModelContent(content, domSummary, taskGoal) {
  // Strip markdown code fences
  content = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  try {
    const parsed = JSON.parse(content);
    if (parsed && Array.isArray(parsed.actions) && parsed.actions.length > 0) {
      return parsed;
    }
  } catch { /* try extraction */ }

  const match = content.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (parsed && Array.isArray(parsed.actions) && parsed.actions.length > 0) {
        return parsed;
      }
    } catch { content = match[0]; }
  }

  // Heuristic extraction for local VLM (Moondream/Llava text output matching)
  const actions = [];
  const lowerGoal = (taskGoal || "").toLowerCase();
  const interactables = domSummary?.interactables ?? [];

  // Match target words in task goal to DOM interactables
  for (const el of interactables) {
    const elText = [el.text, el.ariaLabel, el.placeholder, el.name].filter(Boolean).join(" ").toLowerCase();
    if (!elText) continue;

    // Check if element text relates to task goal (e.g., 'cart', 'camera', 'add', 'login', 'search')
    const goalWords = lowerGoal.split(/\s+/).filter((w) => w.length > 2);
    const matchesWord = goalWords.some((w) => elText.includes(w));

    if (matchesWord && /^(button|a|input|select|textarea)$/i.test(el.tag)) {
      const isInput = el.tag === "input" && !["button", "submit", "checkbox"].includes(el.type ?? "");
      actions.push({
        type: isInput ? "TYPE" : "CLICK",
        selector: `#${el.id}`,
        value: isInput ? taskGoal : "",
        label: `Click ${elText.slice(0, 30)}`,
        confidence: 0.9
      });
      break; // Take the first best matching action
    }
  }

  return {
    actions,
    summary: content.slice(0, 250) || "Planned action based on local vision model.",
    requires_confirmation: false
  };
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
    let provider = "unknown";

    // 1. Try Ollama local model first
    const ollamaReady = await isOllamaReady();
    if (ollamaReady) {
      try {
        response = await tryOllama(promptText, dataUrl);
        provider = "ollama-local";
      } catch (err) {
        console.warn(`⚠️ Ollama failed: ${err?.message} — falling back to OpenRouter...`);
      }
    } else {
      console.log("🔄 Ollama not ready or vision model not found — using OpenRouter cloud...");
    }

    // 2. Fallback to OpenRouter if Ollama failed or isn't ready
    if (!response) {
      response = await tryOpenRouter(promptText, dataUrl);
      provider = "openrouter-cloud";
    }

    const content = response.choices[0]?.message?.content ?? "";
    const parsed = parseModelContent(content, dom_summary ?? {}, task_goal);

    const latencyMs = Date.now() - started;
    console.log(`✓ /analyze [${provider}] — ${parsed.actions?.length ?? 0} actions — ${latencyMs}ms — "${task_goal.slice(0, 60)}"`);

    return res.json({
      actions: parsed.actions ?? [],
      summary: parsed.summary ?? "",
      requires_confirmation: parsed.requires_confirmation ?? true,
      latency_ms: latencyMs,
      provider
    });
  } catch (err) {
    console.error("VLM API error:", err?.message ?? err);
    return res.status(500).json({
      error: err?.message ?? "Internal server error",
      actions: [],
      summary: "The VLM failed to process the request."
    });
  }
});

// ---- GET /health ----
app.get("/health", async (_req, res) => {
  const ollamaReady = await isOllamaReady();
  const localModel = ollamaReady ? await getLocalModel() : null;
  res.json({
    status: "ok",
    provider: ollamaReady ? "ollama-local + openrouter-fallback" : "openrouter-cloud",
    ollama: ollamaReady,
    local_model: localModel,
    timestamp: Date.now()
  });
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
  Provider: Ollama (local) + OpenRouter (cloud fallback)
  
  → http://localhost:${PORT}/health
  → POST http://localhost:${PORT}/analyze
  `);
});
