# 🎬 ReelForge

An AI wrapper for **Instagram Reel scripts only**. It learns *your* style from your past scripts, hunts **X.com + Reddit** for what's going viral in AI / tech / automation / AI agents / robotics / future tech, classifies it, and writes scripts the way you write them — **10 hooks + one common body**, plus visual ideas for your editor.

For a detailed architectural breakdown and code analysis, see the [ReelForge Codebase Brief](./BRIEF.md).

## Setup

```bash
npm install
set ANTHROPIC_API_KEY=sk-ant-...   # (PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-...")
npm start
# → http://localhost:3040
```

Powered by Claude Opus 4.8 with adaptive thinking and the server-side web search tool.

## How it works

### 0 · Sign up / Log in
The app opens on a **Sign up / Log in** screen. Each account's data — style profile, topics, hook intelligence, and every script — is stored separately under `data/users/<id>/`, so multiple people can use the same install. Passwords are scrypt-hashed; sessions live in an HttpOnly cookie for 30 days. Data created before accounts existed is migrated into the **first** account that signs up.

### 1 · Onboard (required first)
Paste or upload **at least 20** of your past reel scripts (separate pasted scripts with a `---` line; .txt/.docx/.xlsx/.csv accepted). ReelForge extracts your **style profile**: niche, topics, tonality, hook formulas, CTA, script length, and structure. Every script it ever writes is written *as you*.

### 2 · Topics
Topics are pre-selected from your samples. Toggle chips on/off, add your own. The Trend Finder only hunts inside your selected topics.

### 3 · Hook Data (optional but powerful)
Upload a doc/excel of your hook performance data (hooks + views/retention). It distills which hook types and words actually worked on *your* channel, and weighs that on every future hook.

### 4 · Two ways to get a script

**A. Research Dump** — paste your own research. No fact-checking (it trusts your research). It classifies every point into **keep / reject** with reasons, then writes the script from the keepers.

**B. Trend Finder** — give it one topic, or ask for the best **1–30** trending topics. It researches X.com and Reddit (last 7–14 days) and returns a clean table per topic:

| Column | |
|---|---|
| Topic + Category | classified into AI / Tech / Automation / AI Agents / Robotics / Future Tech |
| Why it will perform | for *your* audience |
| Why it's going viral | |
| Research links | real URLs to check |
| Main viral part | the moment driving it |
| People's reaction | X/Reddit sentiment |
| Suggested CTA | |

Every row has a **✍ Make script** button, plus **⚡ Make scripts for ALL topics** at the top.

### The script format (the core thing)

Every script = **10 alternative hooks + ONE common body**:
- Hooks use viral keywords + your own hook-data intelligence, 7–9s spoken, one open loop each.
- Body matches your structure, length and tonality; ends with your CTA.
- **Visual suggestions** per beat so your editor knows exactly what to show.

Scripts are saved to your account's library (`data/users/<id>/scripts/`) with copy buttons for hooks and body.

## Stack

- Node + Express, vanilla JS frontend
- `@anthropic-ai/sdk` — `claude-opus-4-8`, adaptive thinking, streaming, `web_search_20260209`, structured outputs
- `xlsx` + `mammoth` for excel/doc parsing
- JSON file storage under `data/`
