// ---------------------------------------------------------------------------
// Integration configuration types and storage helpers
//
// Non-sensitive config (domain, email, repo, etc.) → localStorage
// Tokens / secrets                                  → sessionStorage
//   (survives navigation within the tab, cleared when tab/browser closes)
//
// To add a new integration:
//   1. Define its Config interface here
//   2. Add storage key constants
//   3. Add load/save helpers for config and token
//   4. Add it to INTEGRATION_REGISTRY below
//   5. Add its section to the Settings page
// ---------------------------------------------------------------------------

const DEFAULT_JIRA_DOMAIN =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_DEFAULT_JIRA_DOMAIN ?? ""
    : "";

// ---------------------------------------------------------------------------
// Jira
// ---------------------------------------------------------------------------

export interface JiraConfig {
  domain: string;
  email: string;
  projectKey: string;
}

const JIRA_CONFIG_KEY = "jira-config";
const JIRA_TOKEN_KEY  = "jira-token";

export function loadJiraConfig(): JiraConfig {
  if (typeof window === "undefined")
    return { domain: DEFAULT_JIRA_DOMAIN, email: "", projectKey: "" };
  try {
    const raw = localStorage.getItem(JIRA_CONFIG_KEY);
    if (!raw) return { domain: DEFAULT_JIRA_DOMAIN, email: "", projectKey: "" };
    return { domain: DEFAULT_JIRA_DOMAIN, ...JSON.parse(raw) } as JiraConfig;
  } catch {
    return { domain: DEFAULT_JIRA_DOMAIN, email: "", projectKey: "" };
  }
}

export function saveJiraConfig(cfg: JiraConfig): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(JIRA_CONFIG_KEY, JSON.stringify(cfg));
}

export function loadJiraToken(): string {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem(JIRA_TOKEN_KEY) ?? "";
}

export function saveJiraToken(token: string): void {
  if (typeof window === "undefined") return;
  if (token) sessionStorage.setItem(JIRA_TOKEN_KEY, token);
  else sessionStorage.removeItem(JIRA_TOKEN_KEY);
}

export function isJiraConfigured(): boolean {
  const cfg = loadJiraConfig();
  return !!(
    cfg.domain.trim() &&
    cfg.email.trim() &&
    cfg.projectKey.trim() &&
    loadJiraToken().trim()
  );
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

export interface GitHubConfig {
  owner: string;
  repo: string;
}

const GITHUB_CONFIG_KEY = "github-config";
const GITHUB_TOKEN_KEY  = "github-token";

export function loadGitHubConfig(): GitHubConfig {
  if (typeof window === "undefined") return { owner: "", repo: "" };
  try {
    const raw = localStorage.getItem(GITHUB_CONFIG_KEY);
    if (!raw) return { owner: "", repo: "" };
    return JSON.parse(raw) as GitHubConfig;
  } catch {
    return { owner: "", repo: "" };
  }
}

export function saveGitHubConfig(cfg: GitHubConfig): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(GITHUB_CONFIG_KEY, JSON.stringify(cfg));
}

export function loadGitHubToken(): string {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem(GITHUB_TOKEN_KEY) ?? "";
}

export function saveGitHubToken(token: string): void {
  if (typeof window === "undefined") return;
  if (token) sessionStorage.setItem(GITHUB_TOKEN_KEY, token);
  else sessionStorage.removeItem(GITHUB_TOKEN_KEY);
}

export function isGitHubConfigured(): boolean {
  const cfg = loadGitHubConfig();
  return !!(cfg.owner.trim() && cfg.repo.trim() && loadGitHubToken().trim());
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
    docsUrl: "https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/",
    isConfigured: isJiraConfigured,
  },
  {
    id: "github",
    name: "GitHub Issues",
    description: "Create GitHub Issues directly from user stories.",
    docsUrl: "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens",
    isConfigured: isGitHubConfigured,
  },
];
