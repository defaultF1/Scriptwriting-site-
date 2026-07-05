// AI engine for ReelForge — Claude first, OpenRouter as an alternative.
// Every call accepts `auth` = the logged-in user's saved API keys
// ({ anthropic, openrouter, openrouter_model, ... }). Resolution order:
//   1. the user's own Claude (Anthropic) key
//   2. the server's ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN env
//   3. the user's OpenRouter key (Claude via OpenRouter; web plugin for research)
// Model policy: claude-opus-4-8 with adaptive thinking. Long outputs are streamed.
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-4-8";
export const OPENROUTER_DEFAULT_MODEL = "anthropic/claude-opus-4.8";

const _clients = new Map(); // apiKey (or "env") → Anthropic client

function anthropicClient(apiKey) {
  const cacheKey = apiKey || "env";
  if (!_clients.has(cacheKey)) {
    _clients.set(cacheKey, apiKey ? new Anthropic({ apiKey }) : new Anthropic());
  }
  return _clients.get(cacheKey);
}

const hasEnvKey = () =>
  !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

/** Which engine a user's keys resolve to: "user-anthropic" | "env" | "openrouter" | "none" */
export function engineFor(auth = {}) {
  if (auth.anthropic) return "user-anthropic";
  if (hasEnvKey()) return "env";
  if (auth.openrouter) return "openrouter";
  return "none";
}

function noKeyError() {
  const err = new Error(
    "No AI key available. Open your account menu (click your name) → API Keys, and add a Claude API key or an OpenRouter key."
  );
  err.status = 503;
  return err;
}

export const WEB_SEARCH_TOOL = { type: "web_search_20260209", name: "web_search" };

const MAX_CONTINUATIONS = 8;

/**
 * Run a (possibly tool-using) Anthropic request to completion, streaming
 * under the hood. Handles pause_turn continuations from server-side tools.
 * Returns the final Message.
 */
async function runToCompletion({ client, system, messages, tools, schema, maxTokens = 16000 }) {
  let msgs = [...messages];
  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      ...(system ? { system } : {}),
      ...(tools ? { tools } : {}),
      // Structured outputs are only used on tool-free calls (web search emits
      // citation-bearing text blocks that don't mix with a JSON-only format).
      ...(schema && !tools
        ? { output_config: { format: { type: "json_schema", schema } } }
        : {}),
      messages: msgs,
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === "pause_turn") {
      msgs = [...msgs, { role: "assistant", content: message.content }];
      continue;
    }
    return message;
  }
  throw new Error("Model did not finish within the continuation limit.");
}

export function messageText(message) {
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

/** Extract a JSON object/array from model text (tolerates prose around it). */
export function extractJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    /* fall through */
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* fall through */
    }
  }
  const start = Math.min(
    ...["{", "["].map((ch) => {
      const idx = text.indexOf(ch);
      return idx === -1 ? Infinity : idx;
    })
  );
  if (start !== Infinity) {
    const open = text[start];
    const close = open === "{" ? "}" : "]";
    const end = text.lastIndexOf(close);
    if (end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
  }
  throw new Error("Model response did not contain valid JSON.");
}

// ---------------------------------------------------------------- OpenRouter

async function openrouterCall({ auth, system, messages, maxTokens = 16000, web = false, jsonHint }) {
  const sys = [system, jsonHint].filter(Boolean).join("\n\n");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.openrouter}`,
      "Content-Type": "application/json",
      "X-Title": "ReelForge"
    },
    body: JSON.stringify({
      model: auth.openrouter_model || OPENROUTER_DEFAULT_MODEL,
      max_tokens: maxTokens,
      ...(web ? { plugins: [{ id: "web" }] } : {}),
      messages: [
        ...(sys ? [{ role: "system", content: sys }] : []),
        ...messages.map((m) => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content)
        }))
      ]
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      `OpenRouter error: ${data.error?.message || res.statusText}. Check your OpenRouter key/model in API Keys.`
    );
    err.status = res.status === 401 ? 503 : 502;
    throw err;
  }
  return data.choices?.[0]?.message?.content ?? "";
}

// ---------------------------------------------------------------- public API

/** Tool-free structured call: returns validated JSON. */
export async function structuredCall({ system, messages, schema, maxTokens = 16000, auth = {} }) {
  const engine = engineFor(auth);
  if (engine === "none") throw noKeyError();

  if (engine === "openrouter") {
    const text = await openrouterCall({
      auth, system, messages, maxTokens,
      jsonHint: `Respond with ONLY a single JSON value (no prose, no markdown fences) matching this JSON Schema:\n${JSON.stringify(schema)}`
    });
    return extractJSON(text);
  }

  const client = anthropicClient(engine === "user-anthropic" ? auth.anthropic : undefined);
  const message = await runToCompletion({ client, system, messages, schema, maxTokens });
  return extractJSON(messageText(message));
}

/** Web-research call that must yield JSON; parsed leniently. */
export async function researchCall({ system, messages, maxTokens = 32000, auth = {} }) {
  const engine = engineFor(auth);
  if (engine === "none") throw noKeyError();

  if (engine === "openrouter") {
    const text = await openrouterCall({ auth, system, messages, maxTokens, web: true });
    return extractJSON(text);
  }

  const client = anthropicClient(engine === "user-anthropic" ? auth.anthropic : undefined);
  const message = await runToCompletion({
    client, system, messages,
    tools: [WEB_SEARCH_TOOL],
    maxTokens,
  });
  return extractJSON(messageText(message));
}
