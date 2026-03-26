"use client";

import { useState, useEffect, useRef } from "react";
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
  isJiraConfigured,
  isGitHubConfigured,
  type JiraConfig,
  type GitHubConfig,
} from "../lib/integrations";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

function Spinner({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
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

// ---------------------------------------------------------------------------
// Integration card definitions
// ---------------------------------------------------------------------------

type IntegrationId = "jira" | "github" | "linear" | "export";

interface IntegrationDef {
  id: IntegrationId;
  name: string;
  tagline: string;
  available: boolean;
  isConfigured: () => boolean;
  icon: React.ReactNode;
  accentFrom: string;
  accentTo: string;
}

function JiraIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
    </svg>
  );
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 .5C5.648.5.5 5.648.5 12a11.5 11.5 0 008 10.938c.6.112.82-.262.82-.582 0-.288-.01-1.05-.016-2.062-3.252.706-3.938-1.568-3.938-1.568-.532-1.35-1.3-1.71-1.3-1.71-1.062-.726.08-.712.08-.712 1.174.082 1.792 1.206 1.792 1.206 1.044 1.79 2.738 1.272 3.406.972.106-.756.41-1.272.744-1.564-2.596-.296-5.326-1.298-5.326-5.776 0-1.276.456-2.32 1.204-3.138-.12-.296-.522-1.49.114-3.106 0 0 .982-.314 3.218 1.2A11.2 11.2 0 0112 6.174c.996.004 2 .134 2.938.394 2.234-1.514 3.214-1.2 3.214-1.2.638 1.616.236 2.81.116 3.106.75.818 1.202 1.862 1.202 3.138 0 4.49-2.734 5.476-5.338 5.766.42.362.794 1.078.794 2.172 0 1.568-.014 2.832-.014 3.218 0 .322.216.698.826.58A11.502 11.502 0 0023.5 12C23.5 5.648 18.352.5 12 .5z" />
    </svg>
  );
}

function LinearIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M3.493 13.017L10.983 20.507C6.311 19.88 2.63 16.737 1.444 12.4l2.05.617zm-.6-2.413l9.98 9.98a10.07 10.07 0 003.534-1.143L4.036 7.06a10.07 10.07 0 00-1.143 3.544zM5.06 5.06l13.881 13.88C21.252 17.078 22.5 14.189 22.5 12c0-5.799-4.701-10.5-10.5-10.5-2.19 0-5.079 1.248-6.94 3.56z" />
    </svg>
  );
}

function ExportIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  );
}

const INTEGRATIONS: IntegrationDef[] = [
  {
    id: "jira",
    name: "Jira",
    tagline: "Push stories as issues to a Jira project",
    available: true,
    isConfigured: isJiraConfigured,
    icon: <JiraIcon className="w-6 h-6 text-white" />,
    accentFrom: "from-blue-600",
    accentTo: "to-indigo-700",
  },
  {
    id: "github",
    name: "GitHub Issues",
    tagline: "Create GitHub Issues from user stories",
    available: true,
    isConfigured: isGitHubConfigured,
    icon: <GitHubIcon className="w-6 h-6 text-white" />,
    accentFrom: "from-zinc-600",
    accentTo: "to-zinc-800",
  },
  {
    id: "linear",
    name: "Linear",
    tagline: "Sync stories to a Linear team",
    available: false,
    isConfigured: () => false,
    icon: <LinearIcon className="w-6 h-6 text-white" />,
    accentFrom: "from-violet-600",
    accentTo: "to-purple-800",
  },
  {
    id: "export",
    name: "Export to file",
    tagline: "Download stories as Markdown, CSV or JSON",
    available: false,
    isConfigured: () => false,
    icon: <ExportIcon className="w-6 h-6 text-white" />,
    accentFrom: "from-emerald-600",
    accentTo: "to-teal-800",
  },
];

// ---------------------------------------------------------------------------
// Gallery card
// ---------------------------------------------------------------------------

function IntegrationCard({
  def,
  selected,
  onClick,
}: {
  def: IntegrationDef;
  selected: boolean;
  onClick: () => void;
}) {
  const configured = def.available ? def.isConfigured() : false;

  return (
    <button
      type="button"
      onClick={def.available ? onClick : undefined}
      disabled={!def.available}
      className={`
        group relative flex flex-col gap-4 rounded-2xl border p-5 text-left transition-all duration-200
        ${def.available ? "cursor-pointer hover:scale-[1.02]" : "cursor-default opacity-50"}
        ${selected
          ? "border-indigo-500/70 bg-zinc-800/80 shadow-lg shadow-indigo-900/20 ring-1 ring-indigo-500/30"
          : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 hover:bg-zinc-800/50"}
      `}
    >
      {/* Icon */}
      <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${def.accentFrom} ${def.accentTo} flex items-center justify-center shadow-md`}>
        {def.icon}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <span className={`text-sm font-bold ${selected ? "text-zinc-100" : "text-zinc-200 group-hover:text-zinc-100"}`}>
            {def.name}
          </span>
          {!def.available && (
            <span className="shrink-0 rounded-full border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-[10px] text-zinc-600">
              Soon
            </span>
          )}
          {def.available && configured && (
            <span className="shrink-0 inline-flex items-center gap-1 rounded-full border border-emerald-800/50 bg-emerald-950/50 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
              <span className="w-1 h-1 rounded-full bg-emerald-400" />
              On
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-zinc-500 leading-relaxed">{def.tagline}</p>
      </div>

      {/* Selected indicator */}
      {selected && (
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-3 h-3 rotate-45 bg-zinc-800 border-r border-b border-indigo-500/70" />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Jira config panel
// ---------------------------------------------------------------------------

function JiraPanel({ onSaved }: { onSaved: () => void }) {
  const [cfg, setCfg]             = useState<JiraConfig>({ domain: "", email: "" });
  const [token, setToken]         = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saved, setSaved]         = useState(false);
  const [testing, setTesting]     = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [projects, setProjects]   = useState<{ key: string; name: string; id: string }[]>([]);

  useEffect(() => {
    setCfg(loadJiraConfig());
    loadJiraToken().then(setToken);
    setTestResult(null);
    setProjects([]);
  }, []);

  async function handleSave() {
    saveJiraConfig(cfg);
    await saveJiraToken(token);
    setSaved(true);
    setTestResult(null);
    setTimeout(() => { setSaved(false); onSaved(); }, 1200);
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    setProjects([]);
    try {
      const params = new URLSearchParams({ domain: cfg.domain, email: cfg.email, token });
      const res = await fetch(`${API_BASE}/api/jira/projects?${params}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = typeof err.detail === "string" ? err.detail : `HTTP ${res.status}`;
        setTestResult({ ok: false, message: msg });
      } else {
        const { projects: list } = await res.json();
        setProjects(list);
        setTestResult({ ok: true, message: `Connected — ${list.length} project(s) found` });
      }
    } catch (e: unknown) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : "Connection failed" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-4">
      <Field label="Jira Domain">
        <input type="text" value={cfg.domain}
          onChange={(e) => { setCfg((c) => ({ ...c, domain: e.target.value })); setProjects([]); setTestResult(null); }}
          placeholder="yourcompany.atlassian.net" className={inputCls} />
      </Field>

      <Field label="Email">
        <input type="email" value={cfg.email}
          onChange={(e) => { setCfg((c) => ({ ...c, email: e.target.value })); setProjects([]); setTestResult(null); }}
          placeholder="you@example.com" className={inputCls} />
      </Field>

      <Field label="API Token" hint="session only">
        <div className="flex gap-2">
          <input type={showToken ? "text" : "password"} value={token}
            onChange={(e) => { setToken(e.target.value); setProjects([]); setTestResult(null); }}
            placeholder="Your Jira API token"
            className={`${inputCls} flex-1`} />
          <button type="button" onClick={() => setShowToken((v) => !v)}
            className="shrink-0 px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-800 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
            {showToken ? "Hide" : "Show"}
          </button>
          <button type="button" onClick={handleTest}
            disabled={testing || !cfg.domain.trim() || !cfg.email.trim() || !token.trim()}
            className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-800 text-xs text-zinc-300 hover:border-zinc-600 hover:text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap">
            {testing ? <Spinner className="w-3.5 h-3.5" /> : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            )}
            Test
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-600">Encrypted and stored locally — persists across page reloads.</p>
      </Field>

      {testResult && (
        <div className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs ${
          testResult.ok ? "bg-emerald-950/50 border border-emerald-800/50 text-emerald-300"
                       : "bg-red-950/50 border border-red-800/50 text-red-300"}`}>
          <span className="shrink-0 mt-0.5">{testResult.ok ? "✓" : "⚠"}</span>
          <span className="flex-1 break-words">{testResult.message}</span>
        </div>
      )}

      {projects.length > 0 && (
        <div className="rounded-lg border border-zinc-700/60 bg-zinc-900/50 divide-y divide-zinc-800 max-h-40 overflow-y-auto">
          {projects.map((p) => (
            <div key={p.id} className="flex items-center gap-2 px-3 py-2">
              <span className="font-mono text-xs text-zinc-400 shrink-0 w-16 truncate">{p.key}</span>
              <span className="text-xs text-zinc-300 truncate">{p.name}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end pt-1">
        <button type="button" onClick={handleSave}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors shadow-md shadow-indigo-900/30">
          {saved ? (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              Saved
            </>
          ) : "Save"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GitHub config panel
// ---------------------------------------------------------------------------

function GitHubPanel({ onSaved }: { onSaved: () => void }) {
  const [token, setToken]           = useState("");
  const [showToken, setShowToken]   = useState(false);
  const [saved, setSaved]           = useState(false);
  const [testing, setTesting]       = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [repos, setRepos]           = useState<{ full_name: string; owner: string; name: string }[]>([]);

  useEffect(() => {
    loadGitHubToken().then(setToken);
    setTestResult(null);
    setRepos([]);
  }, []);

  async function handleSave() {
    await saveGitHubToken(token);
    setSaved(true);
    setTestResult(null);
    setTimeout(() => { setSaved(false); onSaved(); }, 1200);
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    setRepos([]);
    try {
      const params = new URLSearchParams({ token });
      const res = await fetch(`${API_BASE}/api/github/repos?${params}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = typeof err.detail === "string" ? err.detail : `HTTP ${res.status}`;
        setTestResult({ ok: false, message: msg });
      } else {
        const { repos: list } = await res.json();
        setRepos(list);
        setTestResult({ ok: true, message: `Connected — ${list.length} repo(s) found` });
      }
    } catch (e: unknown) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : "Connection failed" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-4">
      <Field label="Personal Access Token">
        <div className="flex gap-2">
          <input type={showToken ? "text" : "password"} value={token}
            onChange={(e) => { setToken(e.target.value); setRepos([]); setTestResult(null); }}
            placeholder="ghp_..." className={`${inputCls} flex-1 font-mono`} />
          <button type="button" onClick={() => setShowToken((v) => !v)}
            className="shrink-0 px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-800 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
            {showToken ? "Hide" : "Show"}
          </button>
          <button type="button" onClick={handleTest}
            disabled={testing || !token.trim()}
            className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-800 text-xs text-zinc-300 hover:border-zinc-600 hover:text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap">
            {testing ? <Spinner className="w-3.5 h-3.5" /> : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            )}
            Test
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-600">
          Requires <span className="font-mono">repo</span> scope. Encrypted and stored locally.
        </p>
      </Field>

      {testResult && (
        <div className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs ${
          testResult.ok ? "bg-emerald-950/50 border border-emerald-800/50 text-emerald-300"
                       : "bg-red-950/50 border border-red-800/50 text-red-300"}`}>
          <span className="shrink-0 mt-0.5">{testResult.ok ? "✓" : "⚠"}</span>
          <span className="flex-1 break-words">{testResult.message}</span>
        </div>
      )}

      {repos.length > 0 && (
        <div className="rounded-lg border border-zinc-700/60 bg-zinc-900/50 divide-y divide-zinc-800 max-h-40 overflow-y-auto">
          {repos.map((r) => (
            <div key={r.full_name} className="flex items-center gap-2 px-3 py-2">
              <span className="text-xs text-zinc-300 truncate font-mono">{r.full_name}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end pt-1">
        <button type="button" onClick={handleSave}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors shadow-md shadow-indigo-900/30">
          {saved ? (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              Saved
            </>
          ) : "Save"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Config panel container (slides in below the gallery)
// ---------------------------------------------------------------------------

function ConfigPanel({
  def,
  onSaved,
  onClose,
}: {
  def: IntegrationDef;
  onSaved: () => void;
  onClose: () => void;
}) {
  return (
    <div className="rounded-2xl border border-indigo-500/30 bg-zinc-900/80 overflow-hidden shadow-xl shadow-black/40 animate-in">
      {/* Panel header */}
      <div className={`flex items-center gap-3 px-5 py-4 border-b border-zinc-800 bg-gradient-to-r ${def.accentFrom}/20 ${def.accentTo}/10`}>
        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${def.accentFrom} ${def.accentTo} flex items-center justify-center shrink-0`}>
          <div className="w-4 h-4">{def.icon}</div>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-zinc-100">{def.name}</h3>
          <p className="text-xs text-zinc-500">{def.tagline}</p>
        </div>
        <button type="button" onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
          aria-label="Close">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Panel body */}
      <div className="px-5 py-5">
        {def.id === "jira"   && <JiraPanel   onSaved={onSaved} />}
        {def.id === "github" && <GitHubPanel onSaved={onSaved} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const [selectedId, setSelectedId] = useState<IntegrationId | null>(null);
  const [configuredMap, setConfiguredMap] = useState<Record<string, boolean>>({});
  const panelRef = useRef<HTMLDivElement>(null);

  // Recompute configured states on mount and after save
  function refreshConfigured() {
    const map: Record<string, boolean> = {};
    INTEGRATIONS.forEach((def) => { map[def.id] = def.available ? def.isConfigured() : false; });
    setConfiguredMap(map);
  }

  useEffect(() => { refreshConfigured(); }, []);

  function handleSelect(id: IntegrationId) {
    setSelectedId((prev) => (prev === id ? null : id));
    // Scroll to panel after render
    setTimeout(() => { panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, 50);
  }

  const selectedDef = INTEGRATIONS.find((d) => d.id === selectedId) ?? null;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Top bar */}
      <header className="sticky top-0 z-10 flex items-center gap-3 px-6 py-3 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur-sm">
        <Link href="/"
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-200 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to workspace
        </Link>

        <div className="h-4 w-px bg-zinc-800" />

        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <h1 className="text-sm font-semibold text-zinc-200">Settings</h1>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-6 py-8 space-y-8">

        {/* Section label */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-600">
            Delivery Integrations
          </h2>
          <p className="mt-1 text-xs text-zinc-600">
            Click a card to configure. Tokens are stored in sessionStorage and never sent to the server.
          </p>
        </div>

        {/* Gallery grid */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {INTEGRATIONS.map((def) => (
            <IntegrationCard
              key={def.id}
              def={{ ...def, isConfigured: () => configuredMap[def.id] ?? false }}
              selected={selectedId === def.id}
              onClick={() => handleSelect(def.id)}
            />
          ))}
        </div>

        {/* Config panel — slides in below the grid */}
        <div ref={panelRef}>
          {selectedDef && selectedDef.available && (
            <ConfigPanel
              def={selectedDef}
              onSaved={refreshConfigured}
              onClose={() => setSelectedId(null)}
            />
          )}
        </div>
      </main>
    </div>
  );
}
