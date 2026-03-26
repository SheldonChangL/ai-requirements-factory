// ---------------------------------------------------------------------------
// Integration configuration types and storage helpers
//
// Non-sensitive config (domain, email, repo, etc.) → localStorage (plain)
// Tokens / secrets → localStorage encrypted with AES-GCM
//
// Encryption model:
//   - A random AES-GCM key is generated once per browser session and stored
//     in sessionStorage as a base64 CryptoKey export.
//   - Encrypted payloads (IV + ciphertext) are stored in localStorage.
//   - When the browser/tab closes, sessionStorage is cleared → the key is
//     gone → stored ciphertext cannot be decrypted in a new session
//     (equivalent to clearing the secrets on close).
//   - Within a session, navigating to Settings and back preserves tokens.
//
// To add a new integration:
//   1. Define its Config interface here
//   2. Add storage key constants
//   3. Add load/save helpers (use saveEncrypted / loadEncrypted for tokens)
//   4. Add isConfigured() helper
//   5. Add its card to the Settings page
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AES-GCM crypto helpers (browser-only)
// ---------------------------------------------------------------------------

const CRYPTO_KEY_SESSION_KEY = "ai-factory-ck";

async function getOrCreateCryptoKey(): Promise<CryptoKey> {
  const stored = sessionStorage.getItem(CRYPTO_KEY_SESSION_KEY);
  if (stored) {
    const raw = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
    return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const exported = await crypto.subtle.exportKey("raw", key);
  sessionStorage.setItem(CRYPTO_KEY_SESSION_KEY, btoa(String.fromCharCode(...Array.from(new Uint8Array(exported)))));
  return key;
}

async function encryptToken(plaintext: string): Promise<string> {
  if (!plaintext) return "";
  const key = await getOrCreateCryptoKey();
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipher  = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  // Store as base64(iv):base64(ciphertext)
  const ivB64   = btoa(String.fromCharCode(...Array.from(iv)));
  const ctB64   = btoa(String.fromCharCode(...Array.from(new Uint8Array(cipher))));
  return `${ivB64}:${ctB64}`;
}

async function decryptToken(stored: string): Promise<string> {
  if (!stored) return "";
  try {
    const [ivB64, ctB64] = stored.split(":");
    if (!ivB64 || !ctB64) return "";
    const key    = await getOrCreateCryptoKey();
    const iv     = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
    const cipher = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0));
    const plain  = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
    return new TextDecoder().decode(plain);
  } catch {
    return ""; // key mismatch (new session) → treat as not configured
  }
}

// Sync convenience wrappers used by isConfigured() checks
// (returns "" if the encrypted blob exists but can't be decrypted yet)
function loadEncryptedTokenSync(key: string): string {
  if (typeof window === "undefined") return "";
  // We can't decrypt synchronously, so we return the raw blob as a truthy
  // signal for isConfigured() — actual decryption happens async on use.
  return localStorage.getItem(key) ?? "";
}

// ---------------------------------------------------------------------------
// Jira
// ---------------------------------------------------------------------------

const DEFAULT_JIRA_DOMAIN =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_DEFAULT_JIRA_DOMAIN ?? ""
    : "";

export interface JiraConfig {
  domain: string;
  email: string;
  projectKey?: string; // legacy — project is now selected at publish time via API
}

const JIRA_CONFIG_KEY = "jira-config";
const JIRA_TOKEN_KEY  = "jira-token-enc";

export function loadJiraConfig(): JiraConfig {
  if (typeof window === "undefined")
    return { domain: DEFAULT_JIRA_DOMAIN, email: "" };
  try {
    const raw = localStorage.getItem(JIRA_CONFIG_KEY);
    if (!raw) return { domain: DEFAULT_JIRA_DOMAIN, email: "" };
    return { domain: DEFAULT_JIRA_DOMAIN, ...JSON.parse(raw) } as JiraConfig;
  } catch {
    return { domain: DEFAULT_JIRA_DOMAIN, email: "" };
  }
}

export function saveJiraConfig(cfg: JiraConfig): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(JIRA_CONFIG_KEY, JSON.stringify(cfg));
}

/** Async — returns the decrypted token or "" if not set / key expired. */
export async function loadJiraToken(): Promise<string> {
  if (typeof window === "undefined") return "";
  const blob = localStorage.getItem(JIRA_TOKEN_KEY) ?? "";
  return decryptToken(blob);
}

/** Async — encrypts then persists the token to localStorage. */
export async function saveJiraToken(token: string): Promise<void> {
  if (typeof window === "undefined") return;
  if (!token) { localStorage.removeItem(JIRA_TOKEN_KEY); return; }
  const enc = await encryptToken(token);
  localStorage.setItem(JIRA_TOKEN_KEY, enc);
}

export function isJiraConfigured(): boolean {
  const cfg = loadJiraConfig();
  return !!(
    cfg.domain.trim() &&
    cfg.email.trim() &&
    loadEncryptedTokenSync(JIRA_TOKEN_KEY)
  );
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

export interface GitHubConfig {
  owner?: string; // legacy — repo is now selected at publish time via API
  repo?: string;
}

const GITHUB_CONFIG_KEY = "github-config";
const GITHUB_TOKEN_KEY  = "github-token-enc";

export function loadGitHubConfig(): GitHubConfig {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(GITHUB_CONFIG_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as GitHubConfig;
  } catch {
    return {};
  }
}

export function saveGitHubConfig(cfg: GitHubConfig): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(GITHUB_CONFIG_KEY, JSON.stringify(cfg));
}

export async function loadGitHubToken(): Promise<string> {
  if (typeof window === "undefined") return "";
  const blob = localStorage.getItem(GITHUB_TOKEN_KEY) ?? "";
  return decryptToken(blob);
}

export async function saveGitHubToken(token: string): Promise<void> {
  if (typeof window === "undefined") return;
  if (!token) { localStorage.removeItem(GITHUB_TOKEN_KEY); return; }
  const enc = await encryptToken(token);
  localStorage.setItem(GITHUB_TOKEN_KEY, enc);
}

export function isGitHubConfigured(): boolean {
  return !!loadEncryptedTokenSync(GITHUB_TOKEN_KEY);
}

// ---------------------------------------------------------------------------
// Integration registry — used by Settings page to render integration cards
// ---------------------------------------------------------------------------

export type IntegrationId = "jira" | "github";

export interface IntegrationMeta {
  id: IntegrationId;
  name: string;
  description: string;
  docsUrl?: string;
  isConfigured: () => boolean;
}

export const INTEGRATION_REGISTRY: IntegrationMeta[] = [
  {
    id: "jira",
    name: "Jira",
    description: "Push user stories as issues to a Jira project.",
    isConfigured: isJiraConfigured,
  },
  {
    id: "github",
    name: "GitHub Issues",
    description: "Create GitHub Issues directly from user stories.",
    isConfigured: isGitHubConfigured,
  },
];
