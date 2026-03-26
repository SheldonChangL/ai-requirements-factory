"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  loadJiraConfig,
  saveJiraConfig,
  loadJiraToken,
  saveJiraToken,
  loadGitHubConfig,
  saveGitHubConfig,
  loadGitHubToken,
  saveGitHubToken,
  type JiraConfig,
  type GitHubConfig,
} from "../lib/integrations";

// ---------------------------------------------------------------------------
// Shared UI helpers
// ---------------------------------------------------------------------------

function Spinner({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-zinc-400 mb-1.5">
        {label}
        {hint && <span className="ml-1.5 font-normal text-zinc-600">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

const inputCls =
  "w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors";

function StatusBadge({ configured }: { configured: boolean }) {
  return configured ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-950/60 border border-emerald-800/50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
      Configured
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800/60 border border-zinc-700/50 px-2.5 py-0.5 text-[11px] font-medium text-zinc-500">
      <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
      Not configured
    </span>
  );
}

// ---------------------------------------------------------------------------
// Jira section
// ---------------------------------------------------------------------------

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

function JiraSection() {
  const [cfg, setCfg]         = useState<JiraConfig>({ domain: "", email: "", projectKey: "" });
  const [token, setToken]     = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saved, setSaved]     = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [projects, setProjects] = useState<{ key: string; name: string; id: string }[]>([]);

  useEffect(() => {
    setCfg(loadJiraConfig());
    setToken(loadJiraToken());
  }, []);

  const isConfigured = !!(cfg.domain.trim() && cfg.email.trim() && cfg.projectKey.trim() && token.trim());

  function handleSave() {
    saveJiraConfig(cfg);
    saveJiraToken(token);
    setSaved(true);
    setTestResult(null);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleTestAndLoadProjects() {
    setTesting(true);
    setTestResult(null);
    setProjects([]);
    try {
      const params = new URLSearchParams({
        domain: cfg.domain,
        email: cfg.email,
        token,
      });
      const res = await fetch(`${API_BASE}/api/jira/projects?${params}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = typeof err.detail === "string" ? err.detail : `HTTP ${res.status}`;
        setTestResult({ ok: false, message: msg });
      } else {
        const list = await res.json();
        setProjects(list);
        setTestResult({ ok: true, message: `Connected — ${list.length} project(s) found` });
        if (list.length > 0 && !cfg.projectKey) {
          setCfg((c) => ({ ...c, projectKey: list[0].key }));
        }
      }
    } catch (e: unknown) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : "Connection failed" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
      {/* Card header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-800 bg-gradient-to-r from-blue-950/40 to-indigo-950/20">
        <div className="w-8 h-8 rounded-lg bg-blue-600/80 flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-zinc-100">Jira</h2>
          <p className="text-xs text-zinc-500">Push user stories as issues to a Jira project</p>
        </div>
        <StatusBadge configured={isConfigured} />
      </div>

      {/* Card body */}
      <div className="px-5 py-5 space-y-4">
        <Field label="Jira Domain" hint="e.g. yourcompany.atlassian.net">
          <input
            type="text"
            value={cfg.domain}
            onChange={(e) => { setCfg((c) => ({ ...c, domain: e.target.value })); setProjects([]); setTestResult(null); }}
            placeholder="yourcompany.atlassian.net"
            className={inputCls}
          />
        </Field>

        <Field label="Email">
          <input
            type="email"
            value={cfg.email}
            onChange={(e) => { setCfg((c) => ({ ...c, email: e.target.value })); setProjects([]); setTestResult(null); }}
            placeholder="you@example.com"
            className={inputCls}
          />
        </Field>

        <Field label="API Token" hint="stored in session only">
          <div className="flex gap-2">
            <input
              type={showToken ? "text" : "password"}
              value={token}
              onChange={(e) => { setToken(e.target.value); setProjects([]); setTestResult(null); }}
              placeholder="Your Jira API token"
              className={`${inputCls} flex-1`}
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              className="shrink-0 px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-800 text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
            >
              {showToken ? "Hide" : "Show"}
            </button>
            <button
              type="button"
              onClick={handleTestAndLoadProjects}
              disabled={testing || !cfg.domain.trim() || !cfg.email.trim() || !token.trim()}
              className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-800 text-xs text-zinc-300 hover:border-zinc-600 hover:text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              {testing ? <Spinner className="w-3.5 h-3.5" /> : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              )}
              Test &amp; Load
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-zinc-600">
            Tokens are kept in sessionStorage and cleared when the browser tab closes.
          </p>
        </Field>

        {testResult && (
          <div className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs ${
            testResult.ok
              ? "bg-emerald-950/50 border border-emerald-800/50 text-emerald-300"
              : "bg-red-950/50 border border-red-800/50 text-red-300"
          }`}>
            <span className="shrink-0 mt-0.5">{testResult.ok ? "✓" : "⚠"}</span>
            <span className="flex-1 break-words">{testResult.message}</span>
          </div>
        )}

        <Field
          label="Project Key"
          hint={projects.length > 0 ? `(${projects.length} loaded)` : undefined}
        >
          {projects.length > 0 ? (
            <div className="relative">
              <select
                value={cfg.projectKey}
                onChange={(e) => setCfg((c) => ({ ...c, projectKey: e.target.value }))}
                className={`${inputCls} appearance-none pr-8 cursor-pointer`}
              >
                <option value="" disabled>Select a project…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.key}>
                    {p.name} ({p.key})
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center">
                <svg className="w-3.5 h-3.5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          ) : (
            <input
              type="text"
              value={cfg.projectKey}
              onChange={(e) => setCfg((c) => ({ ...c, projectKey: e.target.value.toUpperCase() }))}
              placeholder="e.g. PROJ"
              className={`${inputCls} font-mono`}
            />
          )}
        </Field>

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors shadow-md shadow-indigo-900/30"
          >
            {saved ? (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                Saved
              </>
            ) : "Save Jira Settings"}
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// GitHub section
// ---------------------------------------------------------------------------

function GitHubSection() {
  const [cfg, setCfg]         = useState<GitHubConfig>({ owner: "", repo: "" });
  const [token, setToken]     = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saved, setSaved]     = useState(false);

  useEffect(() => {
    setCfg(loadGitHubConfig());
    setToken(loadGitHubToken());
  }, []);

  const isConfigured = !!(cfg.owner.trim() && cfg.repo.trim() && token.trim());

  function handleSave() {
    saveGitHubConfig(cfg);
    saveGitHubToken(token);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
      {/* Card header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-800 bg-gradient-to-r from-zinc-900/80 to-zinc-800/30">
        <div className="w-8 h-8 rounded-lg bg-zinc-700 flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 .5C5.648.5.5 5.648.5 12a11.5 11.5 0 008 10.938c.6.112.82-.262.82-.582 0-.288-.01-1.05-.016-2.062-3.252.706-3.938-1.568-3.938-1.568-.532-1.35-1.3-1.71-1.3-1.71-1.062-.726.08-.712.08-.712 1.174.082 1.792 1.206 1.792 1.206 1.044 1.79 2.738 1.272 3.406.972.106-.756.41-1.272.744-1.564-2.596-.296-5.326-1.298-5.326-5.776 0-1.276.456-2.32 1.204-3.138-.12-.296-.522-1.49.114-3.106 0 0 .982-.314 3.218 1.2A11.2 11.2 0 0112 6.174c.996.004 2 .134 2.938.394 2.234-1.514 3.214-1.2 3.214-1.2.638 1.616.236 2.81.116 3.106.75.818 1.202 1.862 1.202 3.138 0 4.49-2.734 5.476-5.338 5.766.42.362.794 1.078.794 2.172 0 1.568-.014 2.832-.014 3.218 0 .322.216.698.826.58A11.502 11.502 0 0023.5 12C23.5 5.648 18.352.5 12 .5z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-zinc-100">GitHub Issues</h2>
          <p className="text-xs text-zinc-500">Create GitHub Issues directly from user stories</p>
        </div>
        <StatusBadge configured={isConfigured} />
      </div>

      {/* Card body */}
      <div className="px-5 py-5 space-y-4">
        <Field label="Owner" hint="org or username">
          <input
            type="text"
            value={cfg.owner}
            onChange={(e) => setCfg((c) => ({ ...c, owner: e.target.value }))}
            placeholder="your-org-or-username"
            className={inputCls}
          />
        </Field>

        <Field label="Repository">
          <input
            type="text"
            value={cfg.repo}
            onChange={(e) => setCfg((c) => ({ ...c, repo: e.target.value }))}
            placeholder="repo-name"
            className={inputCls}
          />
        </Field>

        <Field label="Personal Access Token" hint="stored in session only">
          <div className="flex gap-2">
            <input
              type={showToken ? "text" : "password"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_..."
              className={`${inputCls} flex-1 font-mono`}
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              className="shrink-0 px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-800 text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
            >
              {showToken ? "Hide" : "Show"}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-zinc-600">
            Requires <span className="font-mono">repo</span> scope. Token is kept in sessionStorage only.
          </p>
        </Field>

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors shadow-md shadow-indigo-900/30"
          >
            {saved ? (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                Saved
              </>
            ) : "Save GitHub Settings"}
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Future integration placeholder card
// ---------------------------------------------------------------------------

function ComingSoonCard({ name, description }: { name: string; description: string }) {
  return (
    <section className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 px-5 py-5 flex items-center gap-4 opacity-50">
      <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0">
        <svg className="w-4 h-4 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 4v16m8-8H4" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="text-sm font-semibold text-zinc-500">{name}</h2>
        <p className="text-xs text-zinc-700">{description}</p>
      </div>
      <span className="shrink-0 rounded-full border border-zinc-700 bg-zinc-800/50 px-2.5 py-0.5 text-[11px] text-zinc-600">
        Coming soon
      </span>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Top bar */}
      <header className="sticky top-0 z-10 flex items-center gap-3 px-6 py-3 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur-sm">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-200 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15 19l-7-7 7-7" />
          </svg>
          Back to workspace
        </Link>

        <div className="h-4 w-px bg-zinc-800" />

        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <h1 className="text-sm font-semibold text-zinc-200">Settings</h1>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        {/* Section heading */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-600 mb-1">
            Delivery Integrations
          </h2>
          <p className="text-xs text-zinc-600">
            Configure third-party services for publishing user stories. Tokens are kept in
            sessionStorage and are never sent to or stored on the server.
          </p>
        </div>

        <JiraSection />
        <GitHubSection />

        {/* Future integrations */}
        <ComingSoonCard
          name="Linear"
          description="Push user stories as issues to a Linear team."
        />
        <ComingSoonCard
          name="Export to file"
          description="Download user stories as Markdown, CSV, or JSON."
        />
      </main>
    </div>
  );
}
