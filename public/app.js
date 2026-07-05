// ReelForge frontend — "Call Sheet" UI
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let state = { profile: null, topics: [], hook_intel: null, scripts: [] };
let lastTrends = [];
let nicheState = []; // [{name, on}] for the Trend Finder niche picker

const CORE_NICHES = ["AI", "Tech", "Automation", "AI Agents", "Robotics", "Future Tech"];

// ------------------------------------------------------------ helpers

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `${res.status} ${res.statusText}`);
    err.auth = res.status === 401;
    throw err;
  }
  return data;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function toast(msg, isError = false) {
  const t = document.createElement("div");
  t.className = "toast" + (isError ? " error" : "");
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 5000);
}

function busy(btn, on) {
  btn.disabled = on;
  btn.dataset.label ??= btn.textContent;
  btn.textContent = on ? "Working…" : btn.dataset.label;
}

function emptyState(icon, text) {
  return `<div class="empty"><span class="big-ico">${icon}</span>${esc(text)}</div>`;
}

// ------------------------------------------------------------ landing ↔ auth

$$(".try-btn").forEach((b) =>
  b.addEventListener("click", () => {
    document.body.classList.add("authing");
    window.scrollTo({ top: 0 });
  })
);
$("#auth-back").addEventListener("click", () => document.body.classList.remove("authing"));

// ------------------------------------------------------------ auth

let currentUser = null;
let authMode = "login"; // "login" | "signup"

function showApp(user) {
  currentUser = user;
  document.body.classList.remove("booting", "unauthed", "authing");
  document.body.classList.add("authed");
  $("#user-name").textContent = user.name;
  $("#user-email").textContent = user.email;
  $("#user-avatar").textContent = (user.name || "?").trim().charAt(0).toUpperCase() || "?";
}

function showAuth() {
  currentUser = null;
  document.body.classList.remove("booting", "authed", "authing"); // lands on the landing page
  document.body.classList.add("unauthed");
  $("#auth-password").value = "";
  authError(null);
}

function authError(msg) {
  const el = $("#auth-error");
  el.classList.toggle("hidden", !msg);
  el.textContent = msg || "";
}

function setAuthMode(mode) {
  authMode = mode;
  $("#auth-tab-login").classList.toggle("active", mode === "login");
  $("#auth-tab-signup").classList.toggle("active", mode === "signup");
  $("#auth-name-field").classList.toggle("hidden", mode === "login");
  $("#auth-password").setAttribute("autocomplete", mode === "login" ? "current-password" : "new-password");
  const submit = $("#auth-submit");
  submit.textContent = mode === "login" ? "Log in →" : "Create my account →";
  submit.dataset.label = submit.textContent;
  $("#auth-switch-text").textContent = mode === "login" ? "New here?" : "Already have an account?";
  $("#auth-switch").textContent = mode === "login" ? "Create an account" : "Log in";
  authError(null);
}
$("#auth-tab-login").addEventListener("click", () => setAuthMode("login"));
$("#auth-tab-signup").addEventListener("click", () => setAuthMode("signup"));
$("#auth-switch").addEventListener("click", () => setAuthMode(authMode === "login" ? "signup" : "login"));

$("#auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#auth-email").value.trim();
  const password = $("#auth-password").value;
  const name = $("#auth-name").value.trim();
  if (!email || !password) return authError("Fill in your email and password.");
  if (authMode === "signup" && !name) return authError("Tell me your name.");

  const btn = $("#auth-submit");
  busy(btn, true);
  try {
    const { user } = await api(`/api/auth/${authMode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(authMode === "signup" ? { name, email, password } : { email, password })
    });
    showApp(user);
    toast(authMode === "signup" ? `Welcome, ${user.name} — your account is ready.` : `Welcome back, ${user.name}.`);
    await refresh();
  } catch (err) {
    authError(err.message);
  }
  busy(btn, false);
});

$("#logout-btn").addEventListener("click", async () => {
  $("#user-menu").classList.add("hidden");
  try { await api("/api/auth/logout", { method: "POST" }); } catch { /* logging out anyway */ }
  showAuth();
  toast("Logged out. Your data is saved to your account.");
});

// ------------------------------------------------------------ account menu

$("#user-menu-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  $("#user-menu").classList.toggle("hidden");
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".user-wrap")) $("#user-menu").classList.add("hidden");
});
$$("#user-menu [data-menu]").forEach((b) =>
  b.addEventListener("click", () => {
    $("#user-menu").classList.add("hidden");
    openSettings(b.dataset.menu === "profile" ? "profile" : "keys");
  })
);

// ------------------------------------------------------------ settings modal

function setSettingsTab(tab) {
  $("#set-tab-profile").classList.toggle("active", tab === "profile");
  $("#set-tab-keys").classList.toggle("active", tab === "keys");
  $("#set-profile").classList.toggle("hidden", tab !== "profile");
  $("#set-keys").classList.toggle("hidden", tab !== "keys");
}
$("#set-tab-profile").addEventListener("click", () => setSettingsTab("profile"));
$("#set-tab-keys").addEventListener("click", () => setSettingsTab("keys"));
$("#settings-close").addEventListener("click", () => $("#settings-modal").classList.add("hidden"));
$("#settings-modal").addEventListener("click", (e) => {
  if (e.target === $("#settings-modal")) $("#settings-modal").classList.add("hidden");
});

const ENGINE_LABEL = {
  "user-anthropic": ["ok", "engine: your Claude key ✓ — all features live"],
  "env": ["ok", "engine: server's Claude key — all features live (add your own key to override)"],
  "openrouter": ["ok", "engine: your OpenRouter key — trend research runs through OpenRouter's web plugin"],
  "none": ["warn", "⚠ no AI key yet — add a Claude or OpenRouter key below, or AI calls will fail"]
};

function renderSettings(s) {
  $("#set-name").value = s.user.name;
  $("#set-email").value = s.user.email;
  $("#set-member-since").textContent = "member since " + new Date(s.user.created_at).toLocaleDateString();

  const [cls, text] = ENGINE_LABEL[s.engine] || ENGINE_LABEL.none;
  const es = $("#engine-status");
  es.className = "engine-status " + cls;
  es.textContent = text;

  for (const [field, saved] of Object.entries(s.keys)) {
    const state = $(`[data-state="${field}"]`);
    const rm = $(`[data-remove="${field}"]`);
    const input = $(`[data-key="${field}"]`);
    if (state) {
      state.textContent = saved ? `saved · ${saved}` : "not set";
      state.classList.toggle("set", !!saved);
    }
    if (rm) rm.classList.toggle("hidden", !saved);
    if (input) input.value = "";
  }
  // the model field is not a secret — show it as-is for editing
  $('[data-key="openrouter_model"]').value = s.keys.openrouter_model || "";
}

async function openSettings(tab) {
  try {
    renderSettings(await api("/api/settings"));
    setSettingsTab(tab);
    $("#settings-modal").classList.remove("hidden");
  } catch (e) { toast(e.message, true); }
}

$("#set-profile-save").addEventListener("click", async () => {
  const btn = $("#set-profile-save");
  busy(btn, true);
  try {
    const { user } = await api("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: $("#set-name").value })
    });
    showApp(user); // refreshes name + avatar in the sidebar
    toast("Profile updated.");
  } catch (e) { toast(e.message, true); }
  busy(btn, false);
});

$("#set-keys-save").addEventListener("click", async () => {
  const btn = $("#set-keys-save");
  busy(btn, true);
  try {
    const keys = {};
    $$("#set-keys input[data-key]").forEach((i) => {
      const v = i.value.trim();
      if (i.dataset.key === "openrouter_model") keys[i.dataset.key] = v; // visible field: empty = remove
      else if (v) keys[i.dataset.key] = v;                              // secret fields: empty = keep current
    });
    renderSettings(await api("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys })
    }));
    toast("API keys saved.");
  } catch (e) { toast(e.message, true); }
  busy(btn, false);
});

$$(".key-remove").forEach((b) =>
  b.addEventListener("click", async () => {
    try {
      renderSettings(await api("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: { [b.dataset.remove]: "" } })
      }));
      toast("Key removed.");
    } catch (e) { toast(e.message, true); }
  })
);

// ------------------------------------------------------------ tabs

$$("#tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    $$("#tabs button").forEach((x) => x.classList.remove("active"));
    $$(".tab").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    $(`#tab-${b.dataset.tab}`).classList.add("active");
  })
);

function goTab(name) {
  $$("#tabs button").find((x) => x.dataset.tab === name)?.click();
}

// ------------------------------------------------------------ state load

async function refresh() {
  try {
    state = await api("/api/state");
    document.body.classList.remove("offline");
  } catch (e) {
    if (e.auth) { showAuth(); return; } // session expired → back to login
    document.body.classList.add("offline");
    return;
  }

  const pill = $("#status-pill");
  if (state.profile) {
    pill.textContent = `voice locked · ${state.profile.niche}`;
    pill.classList.remove("empty");
  } else {
    pill.textContent = "no profile yet · onboard first";
    pill.classList.add("empty");
  }

  $("#st-onboard").classList.toggle("done", !!state.profile);
  $("#st-topics").classList.toggle("done", (state.topics || []).some((t) => t.selected));
  $("#st-hookdata").classList.toggle("done", !!state.hook_intel);
  $("#st-scripts").classList.toggle("done", (state.scripts || []).length > 0);

  renderTopics();
  renderNiches();
  renderScriptList();
  if (state.hook_intel) renderHookIntel(state.hook_intel);
  if (state.profile) renderProfile(state.profile);

  // show the last hunt's results in the Trend Finder (so it's populated on load)
  if ((state.last_trends || []).length && !lastTrends.length) {
    lastTrends = state.last_trends;
    renderTrendTable(lastTrends);
  }
}

// ------------------------------------------------------------ onboarding

// mirrors the server's splitter: first pattern that splits into 2+ chunks wins
function estimateScripts(blob) {
  const text = String(blob || "").replace(/\r\n/g, "\n").trim();
  if (!text) return 0;
  const patterns = [
    /\n\s*(?:-{3,}|={3,}|#{3,}|\*{3,}|_{3,})\s*\n/,
    /\n\s*(?:script|reel|video|hook)\s*#?\d+\s*[:.)\-]?\s*\n/i,
    /\n\s*\d{1,3}\s*[).:\-]?\s*\n/,
    /\n\s*\n(?=\s*hook\b\s*[:\-–—])/i,
    /\n{3,}/
  ];
  for (const re of patterns) {
    const parts = text.split(re).map((s) => s.trim()).filter((s) => s.length > 40);
    if (parts.length >= 2) return parts.length;
  }
  return 1;
}

function countScripts() {
  const blob = $("#onboard-blob").value;
  const n = estimateScripts(blob);
  const files = $("#onboard-files").files.length;
  const counter = $("#onboard-count");
  const pasted = n === 1 && blob.trim().length > 1500
    ? "1 block — scripts auto-detected on analyze"
    : `≈ ${n} pasted script(s)`;
  counter.textContent = pasted + (files ? ` + ${files} file(s)` : "");
  counter.classList.toggle("ready", n + files >= 1);
}
$("#onboard-blob").addEventListener("input", countScripts);
$("#onboard-files").addEventListener("change", () => {
  const files = $("#onboard-files").files;
  const label = $("#onboard-files-label");
  const dz = label.closest(".dropzone");
  if (files.length) {
    label.textContent = `${files.length} file(s): ${[...files].slice(0, 3).map((f) => f.name).join(", ")}${files.length > 3 ? "…" : ""}`;
    dz.classList.add("filled");
  } else {
    label.textContent = "drop files · .txt .docx .xlsx .csv";
    dz.classList.remove("filled");
  }
  countScripts();
});

$("#onboard-go").addEventListener("click", async () => {
  const btn = $("#onboard-go");
  busy(btn, true);
  try {
    const fd = new FormData();
    fd.append("blob", $("#onboard-blob").value);
    for (const f of $("#onboard-files").files) fd.append("files", f);
    const data = await api("/api/onboard", { method: "POST", body: fd });
    toast(`Learned your style from ${data.sample_count} scripts.`);
    await refresh();
    renderProfile(data.profile);
  } catch (e) { toast(e.message, true); }
  busy(btn, false);
});

function renderProfile(p) {
  const el = $("#onboard-result");
  el.classList.remove("hidden");
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <h2 style="margin:0">Your voice, decoded</h2>
      <span class="stamp" style="border-color:var(--green);color:var(--green)">VOICE LOCKED</span>
    </div>
    <div class="grid2">
      ${p.sample_count_detected ? `<div><b>Scripts analyzed</b>${p.sample_count_detected}</div>` : ""}
      <div><b>Niche</b>${esc(p.niche)}</div>
      <div><b>Tonality</b>${esc(p.tonality?.voice)} · ${esc(p.tonality?.energy)}</div>
      <div><b>Hooks</b>${(p.hooks?.styles || []).map(esc).join(", ")} (~${p.hooks?.avg_words} words)</div>
      <div><b>CTA</b>${esc(p.cta?.standard_line)}</div>
      <div><b>Length</b>~${p.length?.avg_words} words ≈ ${p.length?.est_seconds}s</div>
      <div><b>Structure</b>${(p.structure?.sections || []).map(esc).join(" → ")}</div>
    </div>
    <h3>viral keywords you lean on</h3>
    <div class="chips">${(p.viral_keywords || []).map((k) => `<span class="chip on sm">${esc(k)}</span>`).join("")}</div>`;
}

// ------------------------------------------------------------ topics

function renderTopics() {
  const wrap = $("#topic-chips");
  if (!(state.topics || []).length) {
    wrap.innerHTML = emptyState("⌁", "No topics yet. Onboard with your scripts first — topics get pre-selected from them.");
    return;
  }
  wrap.innerHTML = "";
  state.topics.forEach((t, i) => {
    const chip = document.createElement("button");
    chip.className = "chip" + (t.selected ? " on" : "");
    chip.textContent = t.name;
    chip.addEventListener("click", () => {
      state.topics[i].selected = !state.topics[i].selected;
      renderTopics();
      renderNiches();
    });
    wrap.appendChild(chip);
  });
}

$("#topic-add").addEventListener("click", async () => {
  const name = $("#topic-new").value.trim();
  if (!name) return;
  try {
    state.topics = await api("/api/topics/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    $("#topic-new").value = "";
    renderTopics();
    renderNiches();
  } catch (e) { toast(e.message, true); }
});

$("#topic-save").addEventListener("click", async () => {
  try {
    await api("/api/topics", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topics: state.topics })
    });
    toast("Topic selection saved.");
    await refresh();
  } catch (e) { toast(e.message, true); }
});

// ------------------------------------------------------------ trend finder niches

function renderNiches() {
  // core niches + the user's selected topics, deduped (case-insensitive)
  const names = [...CORE_NICHES];
  for (const t of (state.topics || []).filter((t) => t.selected)) {
    if (!names.some((n) => n.toLowerCase() === t.name.toLowerCase())) names.push(t.name);
  }
  // keep previous on/off choices; new names default to ON
  nicheState = names.map((name) => {
    const prev = nicheState.find((n) => n.name === name);
    return { name, on: prev ? prev.on : true };
  });

  const wrap = $("#trend-niches");
  wrap.innerHTML = "";
  nicheState.forEach((n, i) => {
    const chip = document.createElement("button");
    chip.className = "chip sm" + (n.on ? " on" : "");
    chip.textContent = n.name;
    chip.addEventListener("click", () => {
      nicheState[i].on = !nicheState[i].on;
      chip.classList.toggle("on", nicheState[i].on);
    });
    wrap.appendChild(chip);
  });
}

// ------------------------------------------------------------ hook data

$("#hook-file").addEventListener("change", () => {
  const f = $("#hook-file").files[0];
  const label = $("#hook-file-label");
  const dz = label.closest(".dropzone");
  if (f) { label.textContent = f.name; dz.classList.add("filled"); }
  else { label.textContent = "drop your hook sheet · .xlsx .csv .docx"; dz.classList.remove("filled"); }
});

$("#hook-go").addEventListener("click", async () => {
  const btn = $("#hook-go");
  busy(btn, true);
  try {
    let data;
    const file = $("#hook-file").files[0];
    if (file) {
      const fd = new FormData();
      fd.append("file", file);
      data = await api("/api/hookdata", { method: "POST", body: fd });
    } else {
      data = await api("/api/hookdata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: $("#hook-text").value })
      });
    }
    renderHookIntel(data);
    await refresh();
    toast("Hook intelligence saved — every future script uses it.");
  } catch (e) { toast(e.message, true); }
  busy(btn, false);
});

function renderHookIntel(x) {
  const el = $("#hook-result");
  el.classList.remove("hidden");
  el.innerHTML = `
    <h2>Hook intelligence</h2>
    <h3>top hook types</h3>
    <div class="chips">${(x.top_hook_types || []).map((k) => `<span class="chip on sm">${esc(k)}</span>`).join("")}</div>
    <h3>winning patterns</h3>
    <ul>${(x.winning_patterns || []).map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
    <h3>words that work</h3>
    <div class="chips">${(x.words_that_work || []).map((k) => `<span class="chip on sm">${esc(k)}</span>`).join("")}</div>
    <h3>words to avoid</h3>
    <div class="chips">${(x.words_to_avoid || []).map((k) => `<span class="chip sm">${esc(k)}</span>`).join("")}</div>
    <h3>insights</h3>
    <ul>${(x.insights || []).map((p) => `<li>${esc(p)}</li>`).join("")}</ul>`;
}

// ------------------------------------------------------------ trends

const TREND_STAGES = [
  "OPENING THE WIRE… connecting to x.com",
  "SCOUTING… screening posts across your niches",
  "CROSS-CHECKING REDDIT… r/singularity, r/artificial, r/robotics",
  "CLASSIFYING… ai / agents / robotics / future tech",
  "TYPING UP THE CALL SHEET…"
];
let stageTimer = null;

function startStages() {
  let i = 0;
  const line = $("#trend-stage-line");
  line.textContent = TREND_STAGES[0];
  clearInterval(stageTimer);
  stageTimer = setInterval(() => {
    i = Math.min(i + 1, TREND_STAGES.length - 1);
    line.textContent = TREND_STAGES[i];
  }, 9000);
}
function stopStages() { clearInterval(stageTimer); stageTimer = null; }

async function findTrends(body) {
  $("#trend-loading").classList.remove("hidden");
  $("#trend-table-wrap").innerHTML = "";
  startStages();
  try {
    const data = await api("/api/trends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    lastTrends = data.topics;
    renderTrendTable(lastTrends);
  } catch (e) { toast(e.message, true); }
  stopStages();
  $("#trend-loading").classList.add("hidden");
}

$("#trend-find").addEventListener("click", () => {
  const niches = nicheState.filter((n) => n.on).map((n) => n.name);
  if (!niches.length) return toast("Select at least one niche to hunt in.", true);
  findTrends({ count: parseInt($("#trend-count").value, 10) || 5, niches });
});
$("#trend-one").addEventListener("click", () => {
  const topic = $("#trend-topic").value.trim();
  if (!topic) return toast("Type a topic first.", true);
  findTrends({ topic });
});

function renderTrendTable(rows) {
  const wrap = $("#trend-table-wrap");
  if (!rows.length) {
    wrap.innerHTML = emptyState("⌀", "Nothing found. Try more niches or a bigger count.");
    return;
  }
  const links = (r) => (r.research_links || [])
    .map((u, j) => `<a href="${esc(u)}" target="_blank" rel="noopener">[${j + 1}]</a>`).join(" ");

  wrap.innerHTML = `
    <div class="row" style="justify-content:flex-end">
      <button id="trend-all" class="flame">⚡ Make scripts for ALL ${rows.length} topics</button>
    </div>

    <div class="scene-list">
      ${rows.map((r, i) => `
      <div class="scene">
        <div class="scene-num"><span>SCENE</span><b>${String(i + 1).padStart(2, "0")}</b></div>
        <div class="scene-body">
          <div class="scene-head">
            <b>${esc(r.topic)}</b>
            <span class="cat" data-cat="${esc(r.category)}">${esc(r.category)}</span>
          </div>
          <div class="scene-grid">
            <div><span class="fld">WHY IT WILL PERFORM</span><p>${esc(r.why_it_will_perform)}</p></div>
            <div><span class="fld">WHY IT'S VIRAL</span><p>${esc(r.why_viral)}</p></div>
            <div><span class="fld">MAIN VIRAL PART</span><p>${esc(r.main_viral_part)}</p></div>
            <div><span class="fld">PEOPLE'S REACTION</span><p>${esc(r.people_reaction)}</p></div>
          </div>
          <div class="scene-foot">
            <span><span class="fld">CTA →</span> ${esc(r.suggested_cta)}</span>
            <span class="links">${links(r)}</span>
          </div>
        </div>
        <div class="scene-act"><button class="mk" data-i="${i}">✍ MAKE SCRIPT</button></div>
      </div>`).join("")}
    </div>`;

  $$(".mk").forEach((b) =>
    b.addEventListener("click", async () => {
      busy(b, true);
      try {
        const script = await api("/api/script", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic: rows[+b.dataset.i] })
        });
        toast("Script ready — see the Scripts tab.");
        await refresh();
        showScript(script);
        goTab("scripts");
      } catch (e) { toast(e.message, true); }
      busy(b, false);
    })
  );

  $("#trend-all").addEventListener("click", async () => {
    const b = $("#trend-all");
    busy(b, true);
    try {
      const { scripts } = await api("/api/script/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topics: rows })
      });
      toast(`${scripts.length} scripts ready — see the Scripts tab.`);
      await refresh();
      goTab("scripts");
    } catch (e) { toast(e.message, true); }
    busy(b, false);
  });
}

// ------------------------------------------------------------ research dump

$("#dump-go").addEventListener("click", async () => {
  const btn = $("#dump-go");
  const dump = $("#dump-text").value.trim();
  if (!dump) return toast("Paste your research first.", true);
  busy(btn, true);
  $("#dump-loading").classList.remove("hidden");
  try {
    const data = await api("/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dump, topic: $("#dump-topic").value.trim() || undefined })
    });
    $("#dump-result").innerHTML = `
      <div class="card">
        <h2>Editorial verdict</h2>
        <h3>✓ kept (${data.analysis.keep.length})</h3>
        <ul>${data.analysis.keep.map((k) => `<li><b>${esc(k.point)}</b> — ${esc(k.why_keep)} <span class="cat">${esc(k.use_as)}</span></li>`).join("")}</ul>
        <h3>✗ rejected (${data.analysis.reject.length})</h3>
        <ul class="muted">${data.analysis.reject.map((k) => `<li>${esc(k.point)} — ${esc(k.why_reject)}</li>`).join("")}</ul>
      </div>`;
    if (data.script) {
      toast("Script written from your research.");
      await refresh();
      showScript(data.script);
      goTab("scripts");
    }
  } catch (e) { toast(e.message, true); }
  $("#dump-loading").classList.add("hidden");
  busy(btn, false);
});

// ------------------------------------------------------------ scripts

function renderScriptList() {
  const wrap = $("#script-list");
  if (!(state.scripts || []).length) {
    wrap.innerHTML = emptyState("🎬", "No scripts yet. Run the Trend Finder or drop a research dump.");
    return;
  }
  wrap.innerHTML = state.scripts
    .map((s) => `<button class="script-card" data-id="${esc(s.id)}">
      <span class="clap"></span>
      <span class="in" style="display:block">
        <b>${esc(s.topic)}</b>
        <span class="meta">${new Date(s.created_at).toLocaleString()} · ${s.hook_count} hooks</span>
      </span>
    </button>`).join("");
  $$(".script-card").forEach((c) =>
    c.addEventListener("click", async () => showScript(await api(`/api/scripts/${c.dataset.id}`)))
  );
}

function showScript(s) {
  $("#script-view").innerHTML = `
    <div class="card script-view-card">
      <div class="clap"></div>
      <div class="in">
        <div class="script-meta">
          <span>≈ ${s.est_duration_seconds ?? "—"}s spoken</span>
          <span>keywords: <span class="kw">${(s.keywords_used || []).map(esc).join(" · ")}</span></span>
        </div>
        <h2>${esc(s.topic)}</h2>

        <h3>10 hooks — pick one <button class="copy" data-copy="hooks">copy all</button></h3>
        <div id="sv-hooks">
          ${(s.hooks || []).map((h, i) => `
            <div class="hook-item">
              <span class="hnum">${String(i + 1).padStart(2, "0")}</span>
              <span class="htext">${esc(h)}</span>
              <button class="copy-one" data-h="${i}">copy</button>
            </div>`).join("")}
        </div>

        <h3>the common body <button class="copy" data-copy="body">copy</button></h3>
        <p class="body-text">${esc(s.body).replace(/\n/g, "<br>")}</p>

        <h3>cta</h3>
        <p class="cta-text">${esc(s.cta)}</p>

        <h3>🎥 visual ideas for the editor</h3>
        <div class="table-scroll"><table class="auto">
          <thead><tr><th style="width:34%">Beat</th><th>Show this</th></tr></thead>
          <tbody>${(s.visual_suggestions || []).map((v) => `<tr><td>${esc(v.beat)}</td><td>${esc(v.visual)}</td></tr>`).join("")}</tbody>
        </table></div>
      </div>
    </div>`;

  $$(".copy").forEach((b) =>
    b.addEventListener("click", () => {
      const text = b.dataset.copy === "hooks"
        ? (s.hooks || []).map((h, i) => `${i + 1}. ${h}`).join("\n\n")
        : `${s.body}\n\n${s.cta}`;
      navigator.clipboard.writeText(text);
      toast("Copied.");
    })
  );
  $$(".copy-one").forEach((b) =>
    b.addEventListener("click", () => {
      navigator.clipboard.writeText(s.hooks[+b.dataset.h]);
      toast(`Hook ${+b.dataset.h + 1} copied.`);
    })
  );
  $("#script-view").scrollIntoView({ behavior: "smooth" });
}

// ------------------------------------------------------------ boot

(async function init() {
  try {
    const { user } = await api("/api/auth/me");
    showApp(user);
    await refresh();
  } catch (e) {
    showAuth();
    // server unreachable (fetch threw) vs. just not logged in (401)
    document.body.classList.toggle("offline", !e.auth);
  }
})();
