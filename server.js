// ReelForge — AI wrapper for Instagram Reel scripts.
// Onboard with 20+ sample scripts → it learns your niche, tone, hooks, CTA,
// length and structure. Then either dump research at it, or let it hunt
// X.com + Reddit for trending topics and write scripts (10 hooks + one body).
// Accounts: signup/login with cookie sessions; every user's data is stored
// separately under data/users/<id>.
import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { structuredCall, researchCall, engineFor, OPENROUTER_DEFAULT_MODEL } from "./lib/anthropic.js";
import * as store from "./lib/store.js";
import * as auth from "./lib/auth.js";
import { fileToText, splitScripts } from "./lib/parse.js";
import {
  PROFILE_SCHEMA, HOOK_INTEL_SCHEMA, DUMP_SCHEMA, SCRIPT_SCHEMA,
  styleAnalystPrompt, hookIntelPrompt, trendFinderPrompt,
  dumpAnalystPrompt, scriptWriterPrompt
} from "./lib/prompts.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use(auth.attachUser);

const today = () => new Date().toISOString().slice(0, 10);
const selectedTopics = (db) =>
  (db.read("topics", []) || []).filter((t) => t.selected).map((t) => t.name);
// the logged-in user's saved API keys, handed to every AI call
const keysOf = (req) => (req.store.read("settings", {}) || {}).keys || {};

// wrap async handlers
const h = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(err);
  let status = err.status || 500;
  let message = err.message || String(err);
  // A 401 inside a handler is always an upstream AI provider rejecting a key
  // (session auth already ran in requireAuth) — don't let it read like a logout.
  if (status === 401 && req.path.startsWith("/api/auth") === false) {
    status = 503;
    message = "The AI provider rejected the API key. Open your account menu → API Keys and check the key you saved.";
  }
  res.status(status).json({ error: message });
});

// ------------------------------------------------------------ auth

app.post("/api/auth/signup", h(async (req, res) => {
  const isFirstUser = auth.userCount() === 0;
  const user = auth.createUser(req.body || {});
  if (isFirstUser) store.migrateLegacyDataTo(user.id); // keep pre-account data
  auth.setSessionCookie(res, auth.createSession(user.id));
  res.json({ user: auth.publicUser(user) });
}));

app.post("/api/auth/login", h(async (req, res) => {
  const user = auth.authenticate(req.body || {});
  auth.setSessionCookie(res, auth.createSession(user.id));
  res.json({ user: auth.publicUser(user) });
}));

app.post("/api/auth/logout", h(async (req, res) => {
  auth.destroySession(auth.readCookie(req));
  auth.clearSessionCookie(res);
  res.json({ ok: true });
}));

app.get("/api/auth/me", h(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not logged in.", auth: true });
  res.json({ user: auth.publicUser(req.user) });
}));

// everything below needs a logged-in user
app.use("/api", auth.requireAuth);

// ------------------------------------------------------------ profile + settings

app.put("/api/profile", h(async (req, res) => {
  const user = auth.updateUser(req.user.id, { name: req.body.name });
  res.json({ user: auth.publicUser(user) });
}));

const KEY_FIELDS = ["anthropic", "openrouter", "openrouter_model", "openai", "x"];
const maskKey = (k) => (k ? "••••••••" + String(k).slice(-4) : null);

function settingsView(req) {
  const keys = keysOf(req);
  return {
    user: auth.publicUser(req.user),
    engine: engineFor(keys),
    openrouter_default_model: OPENROUTER_DEFAULT_MODEL,
    keys: Object.fromEntries(KEY_FIELDS.map((f) => [
      f,
      f === "openrouter_model" ? (keys[f] || null) : maskKey(keys[f])
    ]))
  };
}

app.get("/api/settings", h(async (req, res) => {
  res.json(settingsView(req));
}));

// Body: { keys: { anthropic?, openrouter?, openrouter_model?, openai?, x? } }
// Omitted field → unchanged. Empty string → removed.
app.put("/api/settings", h(async (req, res) => {
  const current = req.store.read("settings", {}) || {};
  const keys = { ...(current.keys || {}) };
  for (const f of KEY_FIELDS) {
    const v = req.body.keys?.[f];
    if (v === undefined) continue;
    const val = String(v).trim();
    if (val) keys[f] = val;
    else delete keys[f];
  }
  req.store.write("settings", { ...current, keys });
  res.json(settingsView(req));
}));

// ------------------------------------------------------------ state

app.get("/api/state", h(async (req, res) => {
  const db = req.store;
  res.json({
    user: auth.publicUser(req.user),
    profile: db.read("profile"),
    topics: db.read("topics", []),
    hook_intel: db.read("hook_intel"),
    last_trends: db.read("last_trends", []),
    scripts: db.listScripts().map(({ id, created_at, topic, hooks }) => ({
      id, created_at, topic, hook_count: hooks?.length ?? 0
    }))
  });
}));

// ------------------------------------------------------------ onboarding

// Accepts pasted scripts (JSON body {scripts:[...]} or {blob:"..."}) and/or files.
app.post("/api/onboard", upload.array("files", 60), h(async (req, res) => {
  const db = req.store;
  let scripts = [];
  if (Array.isArray(req.body.scripts)) scripts = req.body.scripts;
  if (typeof req.body.blob === "string" && req.body.blob.trim()) {
    scripts = scripts.concat(splitScripts(req.body.blob));
  }
  for (const f of req.files || []) {
    const text = await fileToText(f);
    const parts = splitScripts(text);
    scripts = scripts.concat(parts.length ? parts : [text.trim()]);
  }
  scripts = scripts.map((s) => String(s).trim()).filter(Boolean);

  if (!scripts.length) {
    return res.status(400).json({ error: "Paste or upload your scripts first — I got nothing." });
  }

  // No minimum: even one big pasted blob works — the style analyst separates
  // and counts the individual scripts itself (sample_count_detected).
  db.write("samples", scripts);
  const { system, user } = styleAnalystPrompt(scripts);
  const profile = await structuredCall({
    system,
    messages: [{ role: "user", content: user }],
    schema: PROFILE_SCHEMA,
    auth: keysOf(req)
  });
  db.write("profile", profile);

  // Pre-select suggested topics; user can toggle/add in the Topics tab.
  const topics = (profile.suggested_topics || []).map((name) => ({ name, selected: true }));
  db.write("topics", topics);

  res.json({ profile, topics, sample_count: Math.max(profile.sample_count_detected || 0, scripts.length) });
}));

// ------------------------------------------------------------ topics

app.put("/api/topics", h(async (req, res) => {
  const topics = (req.body.topics || [])
    .map((t) => ({ name: String(t.name).trim(), selected: !!t.selected }))
    .filter((t) => t.name);
  res.json(req.store.write("topics", topics));
}));

app.post("/api/topics/add", h(async (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Topic name required." });
  const topics = req.store.read("topics", []) || [];
  if (!topics.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
    topics.push({ name, selected: true });
  }
  res.json(req.store.write("topics", topics));
}));

// ------------------------------------------------------------ hook data

app.post("/api/hookdata", upload.single("file"), h(async (req, res) => {
  const db = req.store;
  let raw = "";
  if (req.file) raw = await fileToText(req.file);
  else if (req.body.text) raw = String(req.body.text);
  if (!raw.trim()) return res.status(400).json({ error: "Upload a doc/excel of hook data or paste it as text." });

  db.write("hook_data_raw", { uploaded_at: new Date().toISOString(), raw });
  const { system, user } = hookIntelPrompt(raw.slice(0, 200000));
  const intel = await structuredCall({
    system,
    messages: [{ role: "user", content: user }],
    schema: HOOK_INTEL_SCHEMA,
    auth: keysOf(req)
  });
  db.write("hook_intel", intel);
  res.json(intel);
}));

// ------------------------------------------------------------ trend finder

// Body: { count: 1..30, niches: ["AI", ...] }  OR  { topic: "user-provided topic" }
app.post("/api/trends", h(async (req, res) => {
  const db = req.store;
  const profile = db.read("profile");
  const singleTopic = req.body.topic ? String(req.body.topic).trim() : null;
  let count = Math.max(1, Math.min(30, parseInt(req.body.count, 10) || 5));

  // niches chosen in the UI take priority; fall back to saved topic selection
  const niches = Array.isArray(req.body.niches)
    ? req.body.niches.map((n) => String(n).trim()).filter(Boolean)
    : [];

  const { system, user } = trendFinderPrompt({
    profile,
    selectedTopics: niches.length ? niches : selectedTopics(db),
    count,
    singleTopic,
    today: today()
  });
  const result = await researchCall({
    system,
    messages: [{ role: "user", content: user }],
    maxTokens: 32000,
    auth: keysOf(req)
  });
  const rows = Array.isArray(result) ? result : [result];
  db.write("last_trends", rows);
  res.json({ topics: rows });
}));

// ------------------------------------------------------------ research dump

// Body: { dump: "...", make_script: true }
app.post("/api/research", h(async (req, res) => {
  const db = req.store;
  const dump = String(req.body.dump || "").trim();
  if (!dump) return res.status(400).json({ error: "Paste your research dump first." });
  const profile = db.read("profile");

  const { system, user } = dumpAnalystPrompt({ dump, profile });
  const analysis = await structuredCall({
    system,
    messages: [{ role: "user", content: user }],
    schema: DUMP_SCHEMA,
    auth: keysOf(req)
  });

  let script = null;
  if (req.body.make_script !== false) {
    const keptResearch = analysis.keep
      .map((k) => `- ${k.point} (use as: ${k.use_as})`)
      .join("\n");
    script = await generateScript(db, {
      topic: String(req.body.topic || "From my research dump"),
      research: keptResearch,
      auth: keysOf(req)
    });
  }
  res.json({ analysis, script });
}));

// ------------------------------------------------------------ scripts

async function generateScript(db, { topic, research, auth }) {
  const profile = db.read("profile");
  const hookIntel = db.read("hook_intel");
  const { system, user } = scriptWriterPrompt({
    profile, hookIntel, topic, research, today: today()
  });
  const script = await structuredCall({
    system,
    messages: [{ role: "user", content: user }],
    schema: SCRIPT_SCHEMA,
    maxTokens: 20000,
    auth
  });
  return db.saveScript(script);
}

// Body: { topic: {topic, research_summary, main_viral_part, ...} }  (a trend row)
//   or  { topic: "plain title", research: "facts..." }
app.post("/api/script", h(async (req, res) => {
  const t = req.body.topic;
  if (!t) return res.status(400).json({ error: "Send a trend row or a topic + research." });
  let title, research;
  if (typeof t === "string") {
    title = t;
    research = String(req.body.research || "").trim();
    if (!research) return res.status(400).json({ error: "For a plain topic, include `research` (facts to write from)." });
  } else {
    title = t.topic;
    research = [
      t.research_summary,
      `Main viral part: ${t.main_viral_part}`,
      `People's reaction: ${t.people_reaction}`,
      `Why it's viral: ${t.why_viral}`,
      `Sources: ${(t.research_links || []).join(", ")}`
    ].filter(Boolean).join("\n");
  }
  res.json(await generateScript(req.store, { topic: title, research, auth: keysOf(req) }));
}));

// Body: { topics: [trendRow, ...] } → generates scripts for all, sequentially.
app.post("/api/script/batch", h(async (req, res) => {
  const rows = req.body.topics || [];
  if (!rows.length) return res.status(400).json({ error: "No topics given." });
  const scripts = [];
  for (const t of rows) {
    const research = [
      t.research_summary,
      `Main viral part: ${t.main_viral_part}`,
      `People's reaction: ${t.people_reaction}`,
      `Why it's viral: ${t.why_viral}`,
      `Sources: ${(t.research_links || []).join(", ")}`
    ].filter(Boolean).join("\n");
    scripts.push(await generateScript(req.store, { topic: t.topic, research, auth: keysOf(req) }));
  }
  res.json({ scripts });
}));

app.get("/api/scripts/:id", h(async (req, res) => {
  const s = req.store.getScript(req.params.id);
  if (!s) return res.status(404).json({ error: "Script not found." });
  res.json(s);
}));

// ------------------------------------------------------------ boot

export default app;

const PORT = process.env.PORT || 3040;
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`ReelForge running → http://localhost:${PORT}`);
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      console.log("⚠ No ANTHROPIC_API_KEY set — the UI will load, but AI calls will fail until you set it.");
    }
  });
}
