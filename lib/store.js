// Tiny JSON-file store. Global data (users, sessions) lives under ./data;
// each account's data lives under ./data/users/<userId>.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = process.env.VERCEL
  ? path.join("/tmp", "data")
  : path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
ensureDir(ROOT);

function readJSON(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
  return value;
}

// ------------------------------------------------------------ global store
// (accounts, sessions — anything not owned by a single user)

export function read(key, fallback = null) {
  return readJSON(path.join(ROOT, `${key}.json`), fallback);
}

export function write(key, value) {
  return writeJSON(path.join(ROOT, `${key}.json`), value);
}

// ------------------------------------------------------------ per-user store

export function forUser(userId) {
  const id = String(userId).replace(/[^a-zA-Z0-9-]/g, "");
  const root = path.join(ROOT, "users", id);
  const scriptsDir = path.join(root, "scripts");
  ensureDir(root);
  ensureDir(scriptsDir);

  return {
    root,

    read(key, fallback = null) {
      return readJSON(path.join(root, `${key}.json`), fallback);
    },

    write(key, value) {
      return writeJSON(path.join(root, `${key}.json`), value);
    },

    saveScript(script) {
      const sid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const record = { id: sid, created_at: new Date().toISOString(), ...script };
      writeJSON(path.join(scriptsDir, `${sid}.json`), record);
      return record;
    },

    listScripts() {
      return fs
        .readdirSync(scriptsDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => readJSON(path.join(scriptsDir, f)))
        .filter(Boolean)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    },

    getScript(id) {
      return readJSON(path.join(scriptsDir, `${path.basename(id)}.json`));
    }
  };
}

/**
 * One-time migration: data written before accounts existed (data/profile.json,
 * topics.json, ... and data/scripts/) gets moved into the first account
 * created, so nothing the user already onboarded is lost.
 */
export function migrateLegacyDataTo(userId) {
  const dest = forUser(userId);
  for (const key of ["profile", "topics", "hook_intel", "hook_data_raw", "samples", "last_trends"]) {
    const src = path.join(ROOT, `${key}.json`);
    if (fs.existsSync(src)) {
      fs.renameSync(src, path.join(dest.root, `${key}.json`));
    }
  }
  const legacyScripts = path.join(ROOT, "scripts");
  if (fs.existsSync(legacyScripts)) {
    for (const f of fs.readdirSync(legacyScripts).filter((f) => f.endsWith(".json"))) {
      fs.renameSync(path.join(legacyScripts, f), path.join(dest.root, "scripts", f));
    }
  }
}
