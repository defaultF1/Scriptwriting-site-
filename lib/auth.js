// Accounts + cookie sessions for ReelForge. Users and sessions live in
// ./data as JSON; passwords are scrypt-hashed, sessions are random tokens
// in an HttpOnly cookie.
import crypto from "crypto";
import * as store from "./store.js";

const COOKIE = "rf_sid";
const SESSION_DAYS = 30;

const users = () => store.read("users", []) || [];
const sessions = () => store.read("sessions", {}) || {};

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(expectedHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, created_at: u.created_at };
}

export function findUserByEmail(email) {
  const norm = String(email || "").trim().toLowerCase();
  return users().find((u) => u.email === norm) || null;
}

export function userCount() {
  return users().length;
}

export function createUser({ name, email, password }) {
  name = String(name || "").trim();
  email = String(email || "").trim().toLowerCase();
  password = String(password || "");

  if (!name) throw httpError(400, "Name is required.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, "Enter a valid email address.");
  if (password.length < 6) throw httpError(400, "Password must be at least 6 characters.");
  if (findUserByEmail(email)) throw httpError(409, "An account with this email already exists — log in instead.");

  const { salt, hash } = hashPassword(password);
  const user = {
    id: crypto.randomUUID(),
    name, email, salt, hash,
    created_at: new Date().toISOString()
  };
  store.write("users", [...users(), user]);
  return user;
}

export function updateUser(id, fields) {
  const all = users();
  const user = all.find((u) => u.id === id);
  if (!user) throw httpError(404, "Account not found.");
  if (fields.name !== undefined) {
    const name = String(fields.name).trim();
    if (!name) throw httpError(400, "Name can't be empty.");
    user.name = name;
  }
  store.write("users", all);
  return user;
}

export function authenticate({ email, password }) {
  const user = findUserByEmail(email);
  if (!user || !verifyPassword(String(password || ""), user.salt, user.hash)) {
    throw httpError(401, "Wrong email or password.");
  }
  return user;
}

// ------------------------------------------------------------ sessions

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const all = sessions();
  all[token] = { userId, created_at: new Date().toISOString() };
  store.write("sessions", pruneSessions(all));
  return token;
}

export function destroySession(token) {
  if (!token) return;
  const all = sessions();
  if (all[token]) {
    delete all[token];
    store.write("sessions", all);
  }
}

function pruneSessions(all) {
  const cutoff = Date.now() - SESSION_DAYS * 864e5;
  for (const [t, s] of Object.entries(all)) {
    if (new Date(s.created_at).getTime() < cutoff) delete all[t];
  }
  return all;
}

export function sessionUser(token) {
  if (!token) return null;
  const s = sessions()[token];
  if (!s) return null;
  if (new Date(s.created_at).getTime() < Date.now() - SESSION_DAYS * 864e5) return null;
  return users().find((u) => u.id === s.userId) || null;
}

// ------------------------------------------------------------ cookies

export function readCookie(req, name = COOKIE) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

export function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie",
    `${COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${SESSION_DAYS * 86400}; SameSite=Lax`);
}

export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

// ------------------------------------------------------------ middleware

/** Attaches req.user + req.store when a valid session cookie is present. */
export function attachUser(req, _res, next) {
  const user = sessionUser(readCookie(req));
  if (user) {
    req.user = user;
    req.store = store.forUser(user.id);
  }
  next();
}

/** Rejects the request with 401 when not logged in. */
export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Please log in first.", auth: true });
  }
  next();
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
