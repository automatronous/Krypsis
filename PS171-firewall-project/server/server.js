/**
 * Krypsis Privacy Vision Agent — Server
 * ------------------------------------
 * Receives a privacy-redacted screenshot + DOM summary from the browser extension,
 * processes it via SmolVLM (local, primary) or OpenRouter Nemotron Ultra (cloud, fallback),
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

// ---- SmolVLM local model state ----
const SMOLVLM_MODEL_ID = process.env.SMOLVLM_MODEL ?? "HuggingFaceTB/SmolVLM-256M-Instruct";
let smolvlmProcessor = null;
let smolvlmModel = null;
let smolvlmLoading = false;
let smolvlmReady = false;

async function loadSmolVLM() {
  if (smolvlmReady || smolvlmLoading) return;
  smolvlmLoading = true;
  try {
    console.log(`🤖 Loading SmolVLM locally: ${SMOLVLM_MODEL_ID} ...`);
    const { AutoProcessor, AutoModelForVision2Seq, env } = await import("@huggingface/transformers");

    env.allowRemoteModels = true;

    smolvlmProcessor = await AutoProcessor.from_pretrained(SMOLVLM_MODEL_ID);
    smolvlmModel = await AutoModelForVision2Seq.from_pretrained(SMOLVLM_MODEL_ID, {
      dtype: "q4"
    });

    smolvlmReady = true;
    smolvlmLoading = false;
    console.log(`✅ SmolVLM ready: ${SMOLVLM_MODEL_ID}`);
  } catch (err) {
    smolvlmLoading = false;
    smolvlmReady = false;
    console.error(`❌ SmolVLM failed to load: ${err?.message}`);
  }
}

// Start loading in background immediately on server start
loadSmolVLM();

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

// Working vision-capable models on OpenRouter
const OPENROUTER_MODELS = [
  "google/gemma-4-31b-it:free",
  "meta-llama/llama-3.2-11b-vision-instruct:free",
  "qwen/qwen-2-vl-72b-instruct:free",
  "openrouter/free"
];

// ---- Build prompt (shared) ----
function buildPrompt(taskGoal, domSummary, pageUrl, ocrText) {
  const interactables = (domSummary.interactables ?? [])
    .slice(0, 80)
    .map((el) => {
      const desc = [el.ariaLabel, el.placeholder, el.text].filter(Boolean).join(" / ").slice(0, 60);
      return `  id="${el.id}" tag=${el.tag} type=${el.type ?? "—"} text="${desc}" name="${el.name ?? ""}"`;
    })
    .join("\n");

  // OCR text context: if available, include visible text to enrich VLM understanding
  const ocrContext = ocrText && Array.isArray(ocrText) && ocrText.length > 0
    ? `\nVISIBLE TEXT ON PAGE (extracted via OCR):\n${ocrText
        .slice(0, 20)
        .map((t) => `  - "${t.text.slice(0, 80)}" (confidence: ${(t.confidence * 100).toFixed(0)}%)`)
        .join("\n")}`
    : "";

  return `Analyze this web page screenshot for task: "${taskGoal}"

PAGE: ${pageUrl}
TITLE: ${domSummary.title ?? "unknown"}

DOM INTERACTABLE ELEMENTS:
${interactables || "None"}${ocrContext}

Generate browser actions to achieve the task. Return ONLY a valid JSON object:
{
  "actions": [
    { "type": "CLICK", "selector": "#element-id", "label": "description", "confidence": 0.9 }
  ],
  "summary": "planned actions",
  "requires_confirmation": false
}
Supported action types: CLICK, TYPE, SCROLL, NAVIGATE, SUBMIT.`;
}

// ---- Try SmolVLM local model ----
async function trySmolVLM(promptText, dataUrl) {
  if (!smolvlmReady) throw new Error("SmolVLM not ready yet");

  console.log(`🤖 Running SmolVLM local inference...`);
  const { RawImage } = await import("@huggingface/transformers");

  const messages = [
    {
      role: "user",
      content: [
        ...(dataUrl ? [{ type: "image" }] : []),
        { type: "text", text: promptText }
      ]
    }
  ];

  // Build chat prompt text
  const text = smolvlmProcessor.apply_chat_template(messages, {
    tokenize: false,
    add_generation_prompt: true
  });

  // Load image if provided
  let images = [];
  if (dataUrl) {
    images = [await RawImage.fromURL(dataUrl)];
  }

  const inputs = await smolvlmProcessor(text, images, { padding: true });
  const ids = await smolvlmModel.generate({
    ...inputs,
    max_new_tokens: 512
  });

  // Decode only the newly generated tokens
  const inputLen = inputs.input_ids.dims[1];
  const newTokens = ids.slice(null, [inputLen, null]);
  const decoded = smolvlmProcessor.batch_decode(newTokens, { skip_special_tokens: true });
  const content = (decoded[0] ?? "").trim();

  console.log(`✅ SmolVLM inference complete: ${content.slice(0, 60)}...`);
  return content;
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
          max_tokens: 1024
        },
        { timeout: 25000 }
      );
      const content = response.choices[0]?.message?.content ?? "";
      console.log(`✓ OpenRouter cloud succeeded: ${modelName}`);
      return content;
    } catch (err) {
      lastErr = err;
      console.warn(`OpenRouter model ${modelName} failed (${err?.message}), trying next...`);
    }
  }
  throw lastErr || new Error("All OpenRouter fallback models failed");
}

// ---- Parse model output to structured actions ----
function parseModelContent(content, domSummary, taskGoal) {
  // Strip markdown code fences
  content = (content ?? "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  // Try direct JSON parse
  try {
    const parsed = JSON.parse(content);
    if (parsed && Array.isArray(parsed.actions) && parsed.actions.length > 0) return parsed;
  } catch { /* continue */ }

  // Extract JSON object substring
  const match = content.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (parsed && Array.isArray(parsed.actions) && parsed.actions.length > 0) return parsed;
    } catch { /* continue */ }
  }

  // Heuristic DOM match fallback for small models or safety-text responses
  const actions = [];
  const lowerGoal = (taskGoal || "").toLowerCase();
  const interactables = domSummary?.interactables ?? [];

  // 1. First search for text input fields if task implies search/type (e.g., "search", "add", "find", "buy", "type")
  const isSearchTask = /search|type|find|buy|add|look/i.test(lowerGoal);
  if (isSearchTask) {
    const inputEl = interactables.find(
      (el) =>
        el.tag === "input" &&
        (!el.type || ["text", "search"].includes(el.type)) &&
        /search|find|query|box|input|text/i.test([el.id, el.name, el.placeholder, el.ariaLabel, el.text].join(" "))
    );
    if (inputEl) {
      // Extract search term from goal (e.g. "search for laptop" -> "laptop", "add camera to cart" -> "camera")
      const cleanedQuery = taskGoal
        .replace(/^(search|find|buy|add|look)\s+(for\s+)?(a\s+)?(the\s+)?/i, "")
        .replace(/\s+(to|in)\s+cart$/i, "")
        .trim();

      actions.push({
        type: "TYPE",
        selector: `#${inputEl.id}`,
        value: cleanedQuery || taskGoal,
        label: `Type "${cleanedQuery}" into search`,
        confidence: 0.9
      });

      // Try finding submit/go button next to it
      const submitBtn = interactables.find(
        (el) =>
          /submit|go|button|search/i.test([el.id, el.name, el.text, el.ariaLabel].join(" ")) &&
          el.id !== inputEl.id
      );
      if (submitBtn) {
        actions.push({
          type: "CLICK",
          selector: `#${submitBtn.id}`,
          label: "Click search button",
          confidence: 0.9
        });
      }
    }
  }

  // 2. Fallback: match any DOM element matching key terms in taskGoal
  if (actions.length === 0) {
    const goalWords = lowerGoal.split(/\s+/).filter((w) => w.length > 2 && !["for", "the", "and", "add", "get"].includes(w));
    for (const el of interactables) {
      const elText = [el.text, el.ariaLabel, el.placeholder, el.name, el.id].filter(Boolean).join(" ").toLowerCase();
      if (!elText) continue;

      if (goalWords.some((w) => elText.includes(w)) && /^(button|a|input|select|textarea)$/i.test(el.tag)) {
        const isInput = el.tag === "input" && !["button", "submit", "checkbox"].includes(el.type ?? "");
        actions.push({
          type: isInput ? "TYPE" : "CLICK",
          selector: `#${el.id}`,
          value: isInput ? taskGoal : undefined,
          label: `${isInput ? "Type in" : "Click"} ${elText.slice(0, 40)}`,
          confidence: 0.85
        });
        break;
      }
    }
  }

  return {
    actions,
    summary: actions.length > 0 ? `Generated ${actions.length} action(s) for "${taskGoal}"` : (content.slice(0, 200) || "No matching interactive element found."),
    requires_confirmation: false
  };
}

// ---- POST /analyze ----
app.post("/analyze", async (req, res) => {
  const { screenshot_b64, dom_summary, task_goal, redacted_regions, page_url, ocr_text } = req.body;

  if (!task_goal) {
    return res.status(400).json({ error: "task_goal is required" });
  }

  const started = Date.now();

  try {
    const promptText = buildPrompt(task_goal, dom_summary ?? {}, page_url ?? "unknown", ocr_text);
    const dataUrl = screenshot_b64
      ? (screenshot_b64.startsWith("data:") ? screenshot_b64 : `data:image/png;base64,${screenshot_b64}`)
      : null;

    let rawContent;
    let provider = "unknown";

    // 1. Try SmolVLM local model first
    if (smolvlmReady) {
      try {
        rawContent = await trySmolVLM(promptText, dataUrl);
        provider = "smolvlm-local";
      } catch (err) {
        console.warn(`⚠️ SmolVLM failed: ${err?.message} — falling back to OpenRouter...`);
      }
    } else {
      console.log(`🔄 SmolVLM not ready (still loading or unavailable) — using OpenRouter cloud...`);
    }

    // 2. Fallback to OpenRouter cloud
    if (!rawContent) {
      try {
        rawContent = await tryOpenRouter(promptText, dataUrl);
        provider = "openrouter-cloud";
      } catch (cloudErr) {
        console.warn(`⚠️ Cloud VLM failed (${cloudErr?.message}), generating fallback DOM action...`);
        rawContent = ""; // trigger parseModelContent heuristic fallback
        provider = "dom-heuristic-fallback";
      }
    }

    const parsed = parseModelContent(rawContent, dom_summary ?? {}, task_goal);
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
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    provider: smolvlmReady ? "smolvlm-local + openrouter-fallback" : "openrouter-cloud",
    smolvlm: smolvlmReady,
    smolvlm_loading: smolvlmLoading,
    local_model: smolvlmReady ? SMOLVLM_MODEL_ID : null,
    cloud_model: OPENROUTER_MODELS[0],
    timestamp: Date.now()
  });
});

// ---- Start ----
app.listen(PORT, () => {
  console.log(`
  ██╗  ██╗██████╗ ██╗   ██╗██████╗ ███████╗██╗███████╗
  ██║ ██╔╝██╔══██╗╚██╗ ██╔╝██╔══██╗██╔════╝██║██╔════╝
  █████╔╝ ██████╔╝ ╚████╔╝ ██████╔╝███████╗██║███████╗
  ██╔═██╗ ██╔══██╗  ╚██╔╝  ██╔═══╝ ╚════██║██║╚════██║
  ██║  ██╗██║  ██║   ██║   ██║     ███████║██║███████║
  ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚══════╝╚═╝╚══════╝

  Krypsis Privacy Vision Agent — Server Side
  Local: SmolVLM-Instruct (HuggingFace Transformers.js)
  Cloud: Nemotron Ultra 253B via OpenRouter (fallback)

  → http://localhost:${PORT}/health
  → POST http://localhost:${PORT}/analyze
  `);
});
