# ReelForge Codebase Brief

ReelForge is a specialized Node.js web application designed to generate optimized, style-matched Instagram Reel scripts. It learns an individual's target style from a set of sample scripts, researches currently trending AI/tech topics on Twitter (X) and Reddit, classifies them, and produces dual-structured scripts (consisting of 10 hooks and a unified body, complete with visual directions).

---

## 📂 Codebase Structure & Components

```plaintext
├── server.js               # Entry point, HTTP API endpoints and routes
├── lib/
│   ├── auth.js            # User accounts, passwords (scrypt), and cookie sessions
│   ├── store.js           # JSON-file database storing global data and user-specific details
│   ├── anthropic.js       # AI client wrapper for Claude 3.7 / 3.5 Opus with Adaptive Thinking
│   ├── parse.js           # Document parsers for uploaded script/hook data (.xlsx, .docx, .txt)
│   └── prompts.js         # Dedicated LLM system inputs and generation prompts
├── public/
│   ├── index.html         # SPA front-end interface, markup, and Tailwind CSS (client-side)
│   └── app.js             # Front-end controller managing app states, API requests, and DOM events
├── package.json            # Dependencies and start scripts
└── .gitignore             # Configured to prevent committing local databases/credentials
```

---

## 🛠 File-by-File Analysis

### 1. `server.js` (Web Server & Endpoints)
The backend is an Express server running in ESM mode (`"type": "module"`). It loads files, configures standard middleware (JSON parsing, cookies, static directories, file uploads via `multer`), and exposes the core service endpoints:
- **Auth Routes**: `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`.
- **Onboarding & Configuration**:
  - `/api/onboard`: Accepts past scripts via text pasting or file uploads, invoking Claude to extract style profiles.
  - `/api/topics`: To view, save, and toggle niche research topics.
  - `/api/hooks-intel`: For uploading hook performance tables to guide the AI hook generation weights.
- **Generation & Search Engine**:
  - `/api/research-dump`: Feeds manual copy-pasted research text into a clean script template.
  - `/api/trends`: Executes real-time search queries to discover trending topics on X and Reddit based on the user's topics.
  - `/api/make-script`: Generates high-retention reel scripts (10 hooks + unified body) from a chosen trend or research node.
  - `/api/make-all-scripts`: Bulk script generation for all researched topics.
- **Library Manager**: `/api/scripts`: Lists and retrieves historical scripts created by the user.

### 2. `lib/auth.js` (Authentication & Security)
- Uses secure session handling with random token cookies (`rf_sid`) sent as `HttpOnly`, `SameSite=Lax`, lasting up to 30 days.
- User passwords are scrypt-hashed and salted using `crypto.scryptSync`.
- Exposes authentication middleware (`attachUser`, `requireAuth`) to secure endpoints.

### 3. `lib/store.js` (Flat-File Storage & Legacy Migration)
- Implements a simple, schema-less file database under the `./data/` folder.
- **Global Storage**: `data/users.json` for password store and `data/sessions.json` for active tokens.
- **User-Specific Storage**: Managed dynamically under `data/users/<userId>/`. Holds:
  - User profiles (`profile.json`)
  - Configured research niches (`topics.json`)
  - Hook analytics (`hook_intel.json`)
  - Script output files (`data/users/<userId>/scripts/*.json`)
- **Migrator**: Includes a `migrateLegacyDataTo(userId)` helper which moves any unauthenticated data created prior to registration into the user’s newly spun account folder.

### 4. `lib/anthropic.js` (AI Engine Adapter)
- **Primary LLM**: Configured for model version `claude-opus-4-8` or fallback to OpenRouter's `anthropic/claude-opus-4.8` endpoints if personal credentials are provided.
- **Adaptive Thinking**: Leverages Claude's native `thinking: { type: "adaptive" }` config to self-correct during output generation.
- **Real-Time Tools**: Utilizes custom tool descriptors like `web_search_20260209` (`web_search`) to scrape trending events from Reddit and X.
- **Structured Data**: Contains helpers (`structuredCall`, `researchCall`, `extractJSON`) to validate, parse, and handle nested JSON schemas.

### 5. `lib/parse.js` (File Extractors)
- Parses multi-format documents:
  - Use of `mammoth` to cleanly strip text content from Word files (`.docx`).
  - Use of `xlsx` to parse spreadsheet tables (`.xlsx`, `.csv`) containing hook analytics or script archives.

### 6. `lib/prompts.js` (LLM Orchestration)
Holds the system instructions and markdown prompt templates.
- Extracts niche structures, audience hooks, hook lengths, and tone markers from uploaded files.
- Guides the writing model to produce 10 varying hook approaches (e.g. pain points, story loops, contrarian assertions, numbers-focused) combined with a high-fidelity visual script track.

### 7. `public/` (Single Page Application Web UI)
- **`index.html`**: A highly interactive Tailwind CSS layout including tabs for onboarding, topic management, hook performance analytics, trend discovery, script editors, and library exports.
- **`app.js`**: Connects form submissions to backend endpoints. Dynamically captures upload states, manages copy-to-clipboard actions, and loads script histories dynamically without reload.

---

## 🔒 Confidentiality & Security Guardrails

The application has been audited to prevent committing confidential secrets to version control.
- **Ignored Directories**:
  - `data/` is blacklisted in `.gitignore`. It contains all local user logins, passwords, profiles, session hashes, and individual generated script documents. **Never push this folder.**
  - `node_modules/` is blacklisted.
- **Secrets Management**:
  - Personal API tokens (`ANTHROPIC_API_KEY`, OpenRouter keys) can either be set as OS environmental variables locally or saved dynamically per-user in protected local json storage, keeping key values off public servers.
  - `.env` files are ignored to prevent checking in local development variables.
