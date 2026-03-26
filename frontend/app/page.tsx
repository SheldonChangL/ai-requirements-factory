"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  FormEvent,
  KeyboardEvent,
} from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import mermaid from "mermaid";
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
} from "./lib/integrations";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ModelChoice = "ollama" | "gemini-cli" | "claude-cli" | "codex-cli";
type DeliveryTarget = "jira" | "github";
type WorkspaceStage = "prd" | "architecture" | "stories";

interface Project {
  id: string;
  name: string;
}

interface QuestionItem {
  id: string;
  category: string;
  question: string;
}

interface Questionnaire {
  title: string;
  questions: QuestionItem[];
}

interface AttachedFile {
  filename: string;
  content: string;
}

interface DeliveryPushResult {
  target: DeliveryTarget;
  count: number;
  items: string[];
}

interface Message {
  role: "user" | "assistant";
  content: string;
  model?: ModelChoice;
  attachments?: string[];
}

interface ChatApiResponse {
  ai_response: string;
  current_prd: string;
  is_ready: boolean;
  model_used: string;
}

interface ThreadStateResponse {
  messages: { role: string; content: string }[];
  current_prd: string;
  is_ready: boolean;
  architecture_draft: string;
  user_stories_draft: string;
}

interface UploadApiResponse {
  filename: string;
  content: string;
}

interface ApiErrorPayload {
  detail?: string | {
    category?: string;
    message?: string;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";
const DEFAULT_JIRA_DOMAIN = process.env.NEXT_PUBLIC_DEFAULT_JIRA_DOMAIN ?? "";
const API_BASE = DEFAULT_API_BASE;
const ACCEPTED_EXTENSIONS = ".xlsx,.xls,.docx,.pdf,.md";
const PROJECTS_STORAGE_KEY = "ai-factory-projects";

const MODEL_OPTIONS: {
  value: ModelChoice;
  label: string;
  color: string;
  dot: string;
}[] = [
  { value: "ollama",     label: "Ollama (llama3)", color: "text-emerald-400", dot: "bg-emerald-400" },
  { value: "gemini-cli", label: "Gemini CLI",      color: "text-blue-400",    dot: "bg-blue-400"    },
  { value: "claude-cli", label: "Claude CLI",      color: "text-purple-400",  dot: "bg-purple-400"  },
  { value: "codex-cli",  label: "Codex CLI",       color: "text-amber-400",   dot: "bg-amber-400"   },
];

const FILE_ICON: Record<string, string> = {
  pdf: "📄", docx: "📝", xlsx: "📊", xls: "📊", md: "📋",
};

const CATEGORY_COLORS: Record<string, string> = {
  Security:         "bg-red-950/80 text-red-300 border-red-700/60",
  Performance:      "bg-amber-950/80 text-amber-300 border-amber-700/60",
  Scalability:      "bg-blue-950/80 text-blue-300 border-blue-700/60",
  Availability:     "bg-emerald-950/80 text-emerald-300 border-emerald-700/60",
  Reliability:      "bg-emerald-950/80 text-emerald-300 border-emerald-700/60",
  Compliance:       "bg-violet-950/80 text-violet-300 border-violet-700/60",
  "Data Retention": "bg-violet-950/80 text-violet-300 border-violet-700/60",
  Functional:       "bg-indigo-950/80 text-indigo-300 border-indigo-700/60",
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function fileIcon(name: string) {
  return FILE_ICON[name.split(".").pop()?.toLowerCase() ?? ""] ?? "📎";
}
function modelColor(m?: ModelChoice) {
  return MODEL_OPTIONS.find((o) => o.value === m)?.color ?? "text-zinc-400";
}
function modelLabel(m?: ModelChoice) {
  return MODEL_OPTIONS.find((o) => o.value === m)?.label ?? "Unknown";
}
function modelDot(m?: ModelChoice) {
  return MODEL_OPTIONS.find((o) => o.value === m)?.dot ?? "bg-zinc-500";
}
function categoryBadgeClass(category: string): string {
  return CATEGORY_COLORS[category] ?? "bg-zinc-800/80 text-zinc-300 border-zinc-600/60";
}
function loadProjects(): Project[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PROJECTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as Project[];
  } catch { /* ignore */ }
  return [];
}
function saveProjects(projects: Project[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
}
function formatApiErrorMessage(payload: ApiErrorPayload, status: number): string {
  if (typeof payload.detail === "string" && payload.detail.trim()) {
    return payload.detail;
  }
  if (payload.detail && typeof payload.detail === "object") {
    const category = typeof payload.detail.category === "string" ? payload.detail.category : "";
    const message = typeof payload.detail.message === "string" ? payload.detail.message : "";
    if (category && message) return `${category}: ${message}`;
    if (message) return message;
  }
  return `HTTP ${status}`;
}
async function throwApiError(response: globalThis.Response): Promise<never> {
  const payload = await response.json().catch(() => ({} as ApiErrorPayload));
  throw new Error(formatApiErrorMessage(payload, response.status));
}

// ---------------------------------------------------------------------------
// Sub-component: Spinner
// ---------------------------------------------------------------------------

function Spinner({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: ModelBadge
// ---------------------------------------------------------------------------

function ModelBadge({ model }: { model?: ModelChoice }) {
  if (!model) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-zinc-800/80 border border-zinc-700/60 ${modelColor(model)}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-90" />
      {modelLabel(model)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: AttachmentChip
// ---------------------------------------------------------------------------

function AttachmentChip({ filename, onRemove }: { filename: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-950/70 border border-indigo-700/50 text-xs text-indigo-300 font-medium max-w-[200px]">
      <span className="shrink-0">{fileIcon(filename)}</span>
      <span className="truncate">{filename}</span>
      {onRemove && (
        <button type="button" onClick={onRemove}
          className="ml-0.5 text-indigo-400 hover:text-red-400 transition-colors shrink-0 leading-none"
          aria-label={`Remove ${filename}`}>
          ×
        </button>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: Mermaid
// ---------------------------------------------------------------------------

function Mermaid({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mermaid.initialize({ startOnLoad: false, theme: "dark" });
    const id = "mermaid-" + Date.now();
    mermaid
      .render(id, chart)
      .then((result) => {
        if (ref.current) ref.current.innerHTML = result.svg;
      })
      .catch(() => {
        if (ref.current)
          ref.current.innerHTML = `<pre style="font-size:11px;overflow-x:auto;">${chart}</pre>`;
      });
  }, [chart]);
  return <div ref={ref} className="my-4 flex justify-center overflow-x-auto" />;
}

// ---------------------------------------------------------------------------
// Sub-component: StageChatPanel
// ---------------------------------------------------------------------------

type AccentColor = "indigo" | "emerald";

const ACCENT_STYLES: Record<AccentColor, { border: string; ring: string; btn: string; dot: string }> = {
  indigo:  { border: "focus:border-indigo-500  focus:ring-indigo-500/40",  ring: "ring-indigo-500/30",  btn: "from-indigo-600 to-violet-600",  dot: "bg-indigo-400" },
  emerald: { border: "focus:border-emerald-500 focus:ring-emerald-500/40", ring: "ring-emerald-500/30", btn: "from-emerald-600 to-teal-600",    dot: "bg-emerald-400" },
};

function StageChatPanel({
  stage,
  accentColor,
  messages,
  input,
  isSending,
  onInputChange,
  onSend,
  placeholder,
}: {
  stage: string;
  accentColor: AccentColor;
  messages: { role: string; content: string }[];
  input: string;
  isSending: boolean;
  onInputChange: (v: string) => void;
  onSend: () => void;
  placeholder: string;
}) {
  const accent = ACCENT_STYLES[accentColor];
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isSending && input.trim()) onSend();
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800/60">
        <span className={`w-1.5 h-1.5 rounded-full ${accent.dot}`} />
        <h4 className="text-sm font-semibold text-zinc-100 capitalize">{stage} Discussion</h4>
        <span className="ml-1.5 text-xs text-zinc-600">
          {messages.length > 0 ? `${Math.ceil(messages.length / 2)} turn${Math.ceil(messages.length / 2) !== 1 ? "s" : ""}` : "No messages yet"}
        </span>
      </div>

      {/* Message history */}
      {messages.length > 0 && (
        <div className="max-h-64 overflow-y-auto px-4 py-3 space-y-3">
          {messages.map((m, i) => (
            <div key={i} className={`flex gap-2.5 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              {m.role === "assistant" && (
                <div className={`w-5 h-5 rounded-full bg-gradient-to-br ${accent.btn} flex items-center justify-center shrink-0 mt-0.5`}>
                  <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" />
                  </svg>
                </div>
              )}
              <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                m.role === "user"
                  ? "bg-zinc-800 text-zinc-200"
                  : "bg-zinc-900 border border-zinc-800 text-zinc-300"
              }`}>
                {m.content}
              </div>
            </div>
          ))}
          {isSending && (
            <div className="flex gap-2.5 justify-start">
              <div className={`w-5 h-5 rounded-full bg-gradient-to-br ${accent.btn} flex items-center justify-center shrink-0 mt-0.5`}>
                <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" />
                </svg>
              </div>
              <div className="rounded-xl bg-zinc-900 border border-zinc-800 px-3 py-2">
                <span className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: "300ms" }} />
                </span>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
      )}

      {/* Input */}
      <div className="px-4 py-3 border-t border-zinc-800/60 flex gap-2 items-end">
        <textarea
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          placeholder={placeholder}
          disabled={isSending}
          className={`flex-1 resize-none rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${accent.border}`}
        />
        <button
          type="button"
          onClick={onSend}
          disabled={isSending || !input.trim()}
          className={`shrink-0 flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-r ${accent.btn} text-white disabled:from-zinc-700 disabled:to-zinc-700 disabled:cursor-not-allowed transition-all shadow-md`}
        >
          {isSending ? (
            <Spinner className="w-3.5 h-3.5" />
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: InteractiveQuestionnaire
// ---------------------------------------------------------------------------

function InteractiveQuestionnaire({
  data,
  onSubmit,
}: {
  data: Questionnaire;
  onSubmit: (formattedAnswers: string) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(data.questions.map((q) => [q.id, ""]))
  );

  const handleChange = (id: string, value: string) =>
    setAnswers((prev) => ({ ...prev, [id]: value }));

  const handleSubmit = () => {
    const formatted = data.questions
      .map((q) => `**Q: ${q.question}**\nA: ${answers[q.id]?.trim() || "(no answer)"}`)
      .join("\n\n");
    onSubmit(formatted);
  };

  const allAnswered = data.questions.every((q) => answers[q.id]?.trim());

  return (
    <div className="my-3 w-full max-w-full rounded-xl border border-zinc-700 bg-zinc-800 overflow-x-hidden shadow-lg shadow-black/30">
      {/* Card header */}
      <div className="flex items-center gap-2.5 px-4 py-3 w-full overflow-x-hidden bg-gradient-to-r from-indigo-950/60 to-violet-950/40 border-b border-zinc-700">
        <div className="w-6 h-6 rounded-md bg-indigo-600/80 flex items-center justify-center shrink-0">
          <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </div>
        <span className="text-sm font-semibold text-zinc-100 break-words whitespace-normal min-w-0">{data.title}</span>
        <span className="ml-auto text-[10px] text-indigo-400 font-mono bg-indigo-950/60 px-2 py-0.5 rounded-full border border-indigo-800/60 shrink-0">
          {data.questions.length}q
        </span>
      </div>

      {/* Questions */}
      <div className="divide-y divide-zinc-700/50 w-full overflow-x-hidden">
        {data.questions.map((q, idx) => (
          <div key={q.id} className="px-4 py-3.5 w-full overflow-x-hidden">
            <div className="flex items-start gap-3 w-full min-w-0">
              <span className="text-[10px] text-zinc-600 font-mono mt-1 shrink-0 tabular-nums">
                {String(idx + 1).padStart(2, "0")}
              </span>
              <div className="flex-1 space-y-2 min-w-0 overflow-x-hidden">
                <div className="flex items-center gap-2">
                  <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full border ${categoryBadgeClass(q.category)}`}>
                    {q.category}
                  </span>
                </div>
                <p className="text-sm text-zinc-200 leading-snug w-full break-words whitespace-normal">{q.question}</p>
                <textarea
                  rows={2}
                  value={answers[q.id] ?? ""}
                  onChange={(e) => handleChange(q.id, e.target.value)}
                  placeholder="Type your answer…"
                  className="w-full break-words whitespace-normal bg-zinc-900 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Submit */}
      <div className="px-4 py-3 bg-zinc-900/50 border-t border-zinc-700/50 flex justify-end">
        <button type="button" onClick={handleSubmit} disabled={!allAnswered}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 disabled:from-zinc-700 disabled:to-zinc-700 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-all shadow-md shadow-indigo-900/30">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
          Submit Answers
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared ReactMarkdown components (with Mermaid + json-questionnaire support)
// ---------------------------------------------------------------------------

function buildMarkdownComponents(
  onQuestionnaireSubmit?: (formatted: string) => void
): Record<string, React.ComponentType<React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }>> {
  return {
    p: ({ children }: React.PropsWithChildren) => (
      <p className="mb-1 last:mb-0">{children}</p>
    ),
    ul: ({ children }: React.PropsWithChildren) => (
      <ul className="list-disc list-inside mb-1 space-y-0.5">{children}</ul>
    ),
    ol: ({ children }: React.PropsWithChildren) => (
      <ol className="list-decimal list-inside mb-1 space-y-0.5">{children}</ol>
    ),
    strong: ({ children }: React.PropsWithChildren) => (
      <strong className="font-semibold text-indigo-300">{children}</strong>
    ),
    code: ({
      className,
      children,
      ...rest
    }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) => {
      if (className === "language-json-questionnaire") {
        const raw = String(children ?? "").trim();
        try {
          const parsed: Questionnaire = JSON.parse(raw);
          if (onQuestionnaireSubmit) {
            return (
              <InteractiveQuestionnaire data={parsed} onSubmit={onQuestionnaireSubmit} />
            );
          }
        } catch { /* fall through to code block */ }
      }
      if (className === "language-mermaid") {
        return <Mermaid chart={String(children ?? "").trim()} />;
      }
      return (
        <code
          className="bg-zinc-700/80 rounded px-1 py-0.5 text-xs font-mono text-emerald-300"
          {...rest}
        >
          {children}
        </code>
      );
    },
  } as Record<string, React.ComponentType<React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }>>;
}

// ---------------------------------------------------------------------------
// PRD pane ReactMarkdown components (prose style, with Mermaid support)
// ---------------------------------------------------------------------------

const prdMarkdownComponents = {
  h1: ({ children }: React.PropsWithChildren) => (
    <h1 className="text-xl font-bold text-zinc-100 mb-4 pb-2 border-b border-zinc-700">{children}</h1>
  ),
  h2: ({ children }: React.PropsWithChildren) => (
    <h2 className="text-base font-semibold text-indigo-400 mt-6 mb-2">{children}</h2>
  ),
  h3: ({ children }: React.PropsWithChildren) => (
    <h3 className="text-sm font-semibold text-zinc-300 mt-4 mb-1.5">{children}</h3>
  ),
  p: ({ children }: React.PropsWithChildren) => (
    <p className="text-sm text-zinc-300 leading-relaxed mb-2">{children}</p>
  ),
  ul: ({ children }: React.PropsWithChildren) => (
    <ul className="list-disc list-inside text-sm text-zinc-300 space-y-1 mb-3 pl-2">{children}</ul>
  ),
  ol: ({ children }: React.PropsWithChildren) => (
    <ol className="list-decimal list-inside text-sm text-zinc-300 space-y-1 mb-3 pl-2">{children}</ol>
  ),
  li: ({ children }: React.PropsWithChildren) => <li className="text-zinc-300">{children}</li>,
  strong: ({ children }: React.PropsWithChildren) => (
    <strong className="font-semibold text-zinc-100">{children}</strong>
  ),
  code: ({
    className,
    children,
    ...rest
  }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) => {
    if (className === "language-mermaid") {
      return <Mermaid chart={String(children ?? "").trim()} />;
    }
    return (
      <code
        className="bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs font-mono text-emerald-400"
        {...rest}
      >
        {children}
      </code>
    );
  },
  blockquote: ({ children }: React.PropsWithChildren) => (
    <blockquote className="border-l-2 border-indigo-500/50 pl-4 my-3 text-zinc-400 italic text-sm">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-zinc-800 my-4" />,
  table: ({ children }: React.PropsWithChildren) => (
    <div className="overflow-x-auto mb-4 rounded-lg border border-zinc-700">
      <table className="min-w-full text-sm">{children}</table>
    </div>
  ),
  th: ({ children }: React.PropsWithChildren) => (
    <th className="bg-zinc-800/80 px-3 py-2 text-left text-xs font-semibold text-zinc-300 border-b border-zinc-700">
      {children}
    </th>
  ),
  td: ({ children }: React.PropsWithChildren) => (
    <td className="px-3 py-2 text-zinc-400 border-b border-zinc-800/60 text-xs">{children}</td>
  ),
};

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function HomePage() {
  // ── Sidebar state ───────────────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // ── Project / Session state ─────────────────────────────────────────────
  const [projects, setProjects]             = useState<Project[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [isHydrating, setIsHydrating]       = useState(false);
  const [deletingId, setDeletingId]         = useState<string | null>(null);

  // ── Chat state ──────────────────────────────────────────────────────────
  const [messages, setMessages]           = useState<Message[]>([]);
  const [userInput, setUserInput]         = useState("");
  const [modelChoice, setModelChoice]     = useState<ModelChoice>("ollama");
  const [isLoading, setIsLoading]         = useState(false);
  const [isUploading, setIsUploading]     = useState(false);
  const [prdDraft, setPrdDraft]           = useState("");
  const [isReady, setIsReady]             = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const [uploadError, setUploadError]     = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [activeWorkspaceStage, setActiveWorkspaceStage] = useState<WorkspaceStage>("prd");
  const [isEditingPrd, setIsEditingPrd]   = useState(false);
  const [editingPrdContent, setEditingPrdContent] = useState("");
  const [isSavingPrd, setIsSavingPrd]     = useState(false);
  const [prdInstruction, setPrdInstruction] = useState("");
  const [isRefiningPrd, setIsRefiningPrd] = useState(false);

  // ── Architecture state ───────────────────────────────────────────────────
  const [architectureDraft, setArchitectureDraft] = useState("");
  const [isGeneratingArch, setIsGeneratingArch]   = useState(false);
  const [isEditingArch, setIsEditingArch]         = useState(false);
  const [editingArchContent, setEditingArchContent] = useState("");
  const [isSavingArch, setIsSavingArch]           = useState(false);
  // ── User Stories state ───────────────────────────────────────────────────
  const [userStoriesDraft, setUserStoriesDraft]       = useState("");
  const [isGeneratingStories, setIsGeneratingStories] = useState(false);
  const [isEditingStories, setIsEditingStories]       = useState(false);
  const [editingStoriesContent, setEditingStoriesContent] = useState("");
  const [isSavingStories, setIsSavingStories]         = useState(false);

  // ── Stage chat state ──────────────────────────────────────────────────────
  const [archChatMessages, setArchChatMessages]     = useState<{role:string;content:string}[]>([]);
  const [archChatInput, setArchChatInput]           = useState("");
  const [isSendingArchChat, setIsSendingArchChat]   = useState(false);
  const [storiesChatMessages, setStoriesChatMessages] = useState<{role:string;content:string}[]>([]);
  const [storiesChatInput, setStoriesChatInput]     = useState("");
  const [isSendingStoriesChat, setIsSendingStoriesChat] = useState(false);

  // ── Delivery state ────────────────────────────────────────────────────────
  const [jiraConfig, setJiraConfig]               = useState<JiraConfig>({ domain: DEFAULT_JIRA_DOMAIN, email: "", projectKey: "" });
  const [jiraToken, setJiraToken]                 = useState("");
  const [githubConfig, setGitHubConfig]           = useState<GitHubConfig>({ owner: "", repo: "" });
  const [githubToken, setGitHubToken]             = useState("");
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [deliveryTarget, setDeliveryTarget]       = useState<DeliveryTarget>("jira");
  const [isPublishingDelivery, setIsPublishingDelivery] = useState(false);
  const [deliveryPushResult, setDeliveryPushResult] = useState<DeliveryPushResult | null>(null);
  const [deliveryErrorMsg, setDeliveryErrorMsg]   = useState<string | null>(null);
  const [jiraProjects, setJiraProjects]           = useState<{ key: string; name: string; id: string }[]>([]);
  const [selectedJiraProjectKey, setSelectedJiraProjectKey] = useState("");
  const [isLoadingJiraProjects, setIsLoadingJiraProjects] = useState(false);
  const [jiraProjectsFetchFailed, setJiraProjectsFetchFailed] = useState(false);

  // ── Amendment Mode banner ─────────────────────────────────────────────────
  const [amendmentBannerDismissed, setAmendmentBannerDismissed] = useState(false);

  // ── Export / Reset state ─────────────────────────────────────────────────
  const [isExporting, setIsExporting]   = useState(false);
  const [isResettingPrd, setIsResettingPrd] = useState(false);

  // ── Model availability state ─────────────────────────────────────────────
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [checkingModels, setCheckingModels]   = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef    = useRef<HTMLTextAreaElement>(null);
  const fileInputRef   = useRef<HTMLInputElement>(null);

  // ── Check model availability on mount ───────────────────────────────────
  useEffect(() => {
    setCheckingModels(true);
    fetch(`${API_BASE}/api/models/check`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ available: string[] }>;
      })
      .then((data) => {
        const avail = data.available ?? [];
        setAvailableModels(avail);
        // Auto-select first available model
        if (avail.length > 0) {
          const firstAvail = MODEL_OPTIONS.find((o) => avail.includes(o.value));
          if (firstAvail) setModelChoice(firstAvail.value);
        }
      })
      .catch(() => {
        // Backend unreachable — default to ollama so the user can still try
        setAvailableModels(["ollama"]);
      })
      .finally(() => setCheckingModels(false));
  }, []);

  // ── Load projects + integration config on mount ──────────────────────────
  useEffect(() => {
    const stored = loadProjects();
    setProjects(stored);
    if (stored.length > 0) {
      setActiveThreadId(stored[0].id);
    }
    setJiraConfig(loadJiraConfig());
    setGitHubConfig(loadGitHubConfig());
    loadJiraToken().then(setJiraToken);
    loadGitHubToken().then(setGitHubToken);
  }, []);

  // ── Hydrate chat state whenever active thread changes ───────────────────
  useEffect(() => {
    if (!activeThreadId) {
      setIsHydrating(false);
      setMessages([]);
      setPrdDraft("");
      setIsReady(false);
      setArchitectureDraft("");
      setUserStoriesDraft("");
      setActiveWorkspaceStage("prd");
      setIsEditingPrd(false);
      setIsEditingArch(false);
      setIsEditingStories(false);
      setPrdInstruction("");
      setArchChatMessages([]);
      setArchChatInput("");
      setStoriesChatMessages([]);
      setStoriesChatInput("");
      setAmendmentBannerDismissed(false);
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    setIsHydrating(true);
    setMessages([]);
    setPrdDraft("");
    setIsReady(false);
    setArchitectureDraft("");
    setUserStoriesDraft("");
    setActiveWorkspaceStage("prd");
    setIsEditingPrd(false);
    setIsEditingArch(false);
    setIsEditingStories(false);
    setPrdInstruction("");
    setArchChatMessages([]);
    setArchChatInput("");
    setStoriesChatMessages([]);
    setStoriesChatInput("");
    setError(null);

    const tid = activeThreadId;

    // Load main thread state + both stage chat histories in parallel
    Promise.all([
      fetch(`${API_BASE}/api/chat/${tid}`, { signal: controller.signal }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ThreadStateResponse>;
      }),
      fetch(`${API_BASE}/api/stage/architecture/chat/${tid}`, { signal: controller.signal })
        .then((r) => r.ok ? r.json() : { messages: [] }),
      fetch(`${API_BASE}/api/stage/stories/chat/${tid}`, { signal: controller.signal })
        .then((r) => r.ok ? r.json() : { messages: [] }),
    ])
      .then(([data, archHistory, storiesHistory]) => {
        setMessages(
          data.messages.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }))
        );
        setPrdDraft(data.current_prd ?? "");
        setIsReady(data.is_ready ?? false);
        setArchitectureDraft(data.architecture_draft ?? "");
        setUserStoriesDraft(data.user_stories_draft ?? "");
        setArchChatMessages(archHistory.messages ?? []);
        setStoriesChatMessages(storiesHistory.messages ?? []);
        if (data.user_stories_draft) {
          setActiveWorkspaceStage("stories");
        } else if (data.architecture_draft) {
          setActiveWorkspaceStage("architecture");
        } else {
          setActiveWorkspaceStage("prd");
        }
      })
      .catch(() => {
        setMessages([]);
        setPrdDraft("");
        setIsReady(false);
        setArchitectureDraft("");
        setUserStoriesDraft("");
        setArchChatMessages([]);
        setStoriesChatMessages([]);
      })
      .finally(() => {
        clearTimeout(timeoutId);
        setIsHydrating(false);
      });

    return () => {
      controller.abort();
      clearTimeout(timeoutId);
      setIsHydrating(false);
    };
  }, [activeThreadId]);

  // ── Auto-scroll ─────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading, isHydrating]);

  // ── Auto-resize textarea ────────────────────────────────────────────────
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [userInput]);

  // ── Project management ──────────────────────────────────────────────────
  const createProject = () => {
    const name = window.prompt("Project name:")?.trim();
    if (!name) return;
    const newProject: Project = { id: Date.now().toString(), name };
    const updated = [...projects, newProject];
    setProjects(updated);
    saveProjects(updated);
    setActiveThreadId(newProject.id);
  };

  const selectProject = (id: string) => {
    setActiveThreadId(id);
    setUserInput("");
    setAttachedFiles([]);
    setError(null);
    setUploadError(null);
    setDeliveryPushResult(null);
    setDeliveryErrorMsg(null);
    setActiveWorkspaceStage("prd");
    setAmendmentBannerDismissed(false);
  };

  const deleteProject = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    setDeletingId(projectId);
    try {
      await fetch(`${API_BASE}/api/chat/${projectId}`, { method: "DELETE" });
    } catch {
      // Ignore network errors — remove locally regardless
    } finally {
      setDeletingId(null);
    }
    const updated = projects.filter((p) => p.id !== projectId);
    setProjects(updated);
    saveProjects(updated);
    if (activeThreadId === projectId) {
      const next = updated[0] ?? null;
      setActiveThreadId(next ? next.id : null);
      setMessages([]);
      setPrdDraft("");
      setIsReady(false);
      setArchitectureDraft("");
      setUserStoriesDraft("");
      setActiveWorkspaceStage("prd");
      setError(null);
    }
  };

  // ── Reset PRD ────────────────────────────────────────────────────────────
  const handleResetPrd = async () => {
    if (!activeThreadId) return;
    const confirmed = window.confirm(
      "This will reset the PRD and architecture. Continue?"
    );
    if (!confirmed) return;

    setIsResettingPrd(true);
    try {
      await fetch(`${API_BASE}/api/reset_prd/${activeThreadId}`, { method: "POST" });
    } catch {
      // Ignore network errors — update local state regardless
    } finally {
      setIsResettingPrd(false);
    }

    setPrdDraft("");
    setIsReady(false);
    setArchitectureDraft("");
    setUserStoriesDraft("");
    setIsEditingPrd(false);
    setIsEditingArch(false);
    setIsEditingStories(false);
    setActiveWorkspaceStage("prd");
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: "PRD has been reset. Please continue refining your requirements.",
      },
    ]);
  };

  // ── Export project ───────────────────────────────────────────────────────
  const handleExport = async () => {
    if (!activeThreadId) return;
    setIsExporting(true);
    try {
      const res = await fetch(`${API_BASE}/api/export/${activeThreadId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${activeThreadId}-project.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Export failed:", e);
    } finally {
      setIsExporting(false);
    }
  };

  const handleSavePrd = async () => {
    if (!activeThreadId || !editingPrdContent.trim()) return;
    setIsSavingPrd(true);
    try {
      const res = await fetch(`${API_BASE}/api/prd/${activeThreadId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editingPrdContent }),
      });
      if (!res.ok) {
        await throwApiError(res);
      }
      const data = await res.json();
      setPrdDraft(data.prd_draft);
      setIsReady(data.is_ready);
      setArchitectureDraft("");
      setUserStoriesDraft("");
      setIsEditingPrd(false);
      setActiveWorkspaceStage("prd");
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Failed to save PRD");
    } finally {
      setIsSavingPrd(false);
    }
  };

  const handleRefinePrd = async () => {
    if (!activeThreadId || !prdInstruction.trim()) return;
    setIsRefiningPrd(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/refine_prd`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: activeThreadId,
          model_choice: modelChoice,
          instruction: prdInstruction,
        }),
      });
      if (!res.ok) {
        await throwApiError(res);
      }
      const data = await res.json();
      setPrdDraft(data.prd_draft);
      setIsReady(data.is_ready);
      setArchitectureDraft("");
      setUserStoriesDraft("");
      setPrdInstruction("");
      setActiveWorkspaceStage("prd");
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Failed to refine PRD");
    } finally {
      setIsRefiningPrd(false);
    }
  };

  // ── Generate Architecture ────────────────────────────────────────────────
  const handleGenerateArchitecture = async () => {
    if (!activeThreadId) return;
    setIsGeneratingArch(true);
    setIsEditingArch(false);
    try {
      const res = await fetch(`${API_BASE}/api/generate_architecture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: activeThreadId, model_choice: modelChoice }),
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setArchitectureDraft(data.architecture_draft);
      setActiveWorkspaceStage("architecture");
    } catch (e) {
      console.error(e);
    } finally {
      setIsGeneratingArch(false);
    }
  };

  // ── Save edited Architecture ──────────────────────────────────────────────
  const handleSaveArchitecture = async () => {
    if (!activeThreadId) return;
    setIsSavingArch(true);
    try {
      const res = await fetch(`${API_BASE}/api/architecture/${activeThreadId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editingArchContent }),
      });
      if (!res.ok) throw new Error("Failed");
      setArchitectureDraft(editingArchContent);
      setUserStoriesDraft("");
      setIsEditingArch(false);
      setActiveWorkspaceStage("architecture");
    } catch (e) {
      console.error(e);
    } finally {
      setIsSavingArch(false);
    }
  };

  // ── Stage chat send ──────────────────────────────────────────────────────
  const handleStageChatSend = async (stage: "architecture" | "stories") => {
    if (!activeThreadId) return;
    const input    = stage === "architecture" ? archChatInput    : storiesChatInput;
    const setInput = stage === "architecture" ? setArchChatInput : setStoriesChatInput;
    const setMsgs  = stage === "architecture" ? setArchChatMessages : setStoriesChatMessages;
    const setSending = stage === "architecture" ? setIsSendingArchChat : setIsSendingStoriesChat;

    if (!input.trim()) return;
    const userMsg = input.trim();
    setInput("");
    setMsgs((prev) => [...prev, { role: "user", content: userMsg }]);
    setSending(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/stage/${stage}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: activeThreadId, user_input: userMsg, model_choice: modelChoice }),
      });
      if (!res.ok) await throwApiError(res);
      const data = await res.json();
      setMsgs((prev) => [...prev, { role: "assistant", content: data.ai_response }]);
      if (data.updated_content) {
        if (stage === "architecture") {
          setArchitectureDraft(data.updated_content);
          setUserStoriesDraft("");
        } else {
          setUserStoriesDraft(data.updated_content);
        }
      }
    } catch (e) {
      setMsgs((prev) => prev.slice(0, -1)); // remove the optimistic user message
      setInput(userMsg);
      setError(e instanceof Error ? e.message : "Stage chat failed");
    } finally {
      setSending(false);
    }
  };

  // ── Regenerate Architecture ───────────────────────────────────────────────
  const handleRegenerateArchitecture = async () => {
    if (!activeThreadId) return;
    const confirmed = window.confirm(
      "Regenerate architecture? This will clear the current architecture and user stories."
    );
    if (!confirmed) return;
    setArchitectureDraft("");
    setUserStoriesDraft("");
    setIsEditingArch(false);
    await handleGenerateArchitecture();
  };

  // ── Generate User Stories ────────────────────────────────────────────────
  const handleGenerateUserStories = async () => {
    if (!activeThreadId) return;
    setIsGeneratingStories(true);
    try {
      const res = await fetch(`${API_BASE}/api/generate_user_stories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: activeThreadId, model_choice: modelChoice }),
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setUserStoriesDraft(data.user_stories_draft);
      setActiveWorkspaceStage("stories");
    } catch (e) {
      console.error(e);
    } finally {
      setIsGeneratingStories(false);
    }
  };

  const handleRegenerateUserStories = async () => {
    if (!activeThreadId) return;
    const confirmed = window.confirm(
      "Regenerate user stories? This will replace the current user stories draft."
    );
    if (!confirmed) return;
    setUserStoriesDraft("");
    setIsEditingStories(false);
    await handleGenerateUserStories();
  };

  const handleSaveUserStories = async () => {
    if (!activeThreadId || !editingStoriesContent.trim()) return;
    setIsSavingStories(true);
    try {
      const res = await fetch(`${API_BASE}/api/user_stories/${activeThreadId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editingStoriesContent }),
      });
      if (!res.ok) {
        await throwApiError(res);
      }
      const data = await res.json();
      setUserStoriesDraft(data.user_stories_draft);
      setIsEditingStories(false);
      setActiveWorkspaceStage("stories");
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Failed to save user stories");
    } finally {
      setIsSavingStories(false);
    }
  };

  const openDeliveryModal = async (target: DeliveryTarget) => {
    setDeliveryTarget(target);
    setShowDeliveryModal(true);
    setDeliveryErrorMsg(null);
    setJiraProjects([]);
    setJiraProjectsFetchFailed(false);
    // Reload config from storage each time the modal opens so it picks up any
    // changes the user may have saved in the Settings page mid-session.
    const freshJiraCfg = loadJiraConfig();
    const freshGithubCfg = loadGitHubConfig();
    setJiraConfig(freshJiraCfg);
    setGitHubConfig(freshGithubCfg);
    const [freshJiraToken, freshGithubToken] = await Promise.all([
      loadJiraToken(),
      loadGitHubToken(),
    ]);
    setJiraToken(freshJiraToken);
    setGitHubToken(freshGithubToken);
    setSelectedJiraProjectKey("");

    // Auto-fetch Jira projects if opening for Jira and credentials are ready
    if (target === "jira" && freshJiraCfg.domain && freshJiraCfg.email && freshJiraToken) {
      setIsLoadingJiraProjects(true);
      try {
        const params = new URLSearchParams({
          domain: freshJiraCfg.domain,
          email: freshJiraCfg.email,
          token: freshJiraToken,
        });
        const res = await fetch(`${API_BASE}/api/jira/projects?${params}`);
        if (res.ok) {
          const { projects: list } = await res.json();
          setJiraProjects(list);
          if (list.length > 0) {
            setSelectedJiraProjectKey(list[0].key);
          }
        } else {
          setJiraProjectsFetchFailed(true);
        }
      } catch {
        setJiraProjectsFetchFailed(true);
      } finally {
        setIsLoadingJiraProjects(false);
      }
    }
  };

  // ── Publish delivery target ──────────────────────────────────────────────
  const handlePublishDelivery = async () => {
    if (!activeThreadId) return;
    setIsPublishingDelivery(true);
    setDeliveryErrorMsg(null);
    setDeliveryPushResult(null);

    try {
      const res = await fetch(`${API_BASE}/api/delivery/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: activeThreadId,
          model_choice: modelChoice,
          target: deliveryTarget,
          jira_domain: jiraConfig.domain,
          jira_email: jiraConfig.email,
          jira_token: jiraToken,
          jira_project_key: selectedJiraProjectKey,
          github_owner: githubConfig.owner,
          github_repo: githubConfig.repo,
          github_token: githubToken,
        }),
      });
      if (!res.ok) {
        await throwApiError(res);
      }
      const data = await res.json();
      setDeliveryPushResult({ target: data.target as DeliveryTarget, count: data.count, items: data.created_items });
      setShowDeliveryModal(false);
    } catch (e: unknown) {
      setDeliveryErrorMsg(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setIsPublishingDelivery(false);
    }
  };

  // ── Core API call ───────────────────────────────────────────────────────
  const callChatApi = useCallback(
    async (backendInput: string, displayContent: string, attachmentNames: string[]) => {
      if (!activeThreadId) return;

      setMessages((prev) => [
        ...prev,
        {
          role: "user",
          content: displayContent,
          model: modelChoice,
          attachments: attachmentNames.length > 0 ? attachmentNames : undefined,
        },
      ]);
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`${API_BASE}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            thread_id: activeThreadId,
            user_input: backendInput,
            model_choice: modelChoice,
          }),
        });

        if (!response.ok) {
          await throwApiError(response);
        }

        const data: ChatApiResponse = await response.json();
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.ai_response, model: data.model_used as ModelChoice },
        ]);
        setPrdDraft(data.current_prd);
        setIsReady(data.is_ready);
      } catch (err: unknown) {
        setError(`Failed to get response: ${err instanceof Error ? err.message : "Unknown error"}`);
      } finally {
        setIsLoading(false);
      }
    },
    [activeThreadId, modelChoice]
  );

  // ── Send from text input ────────────────────────────────────────────────
  const sendMessage = async () => {
    const trimmed = userInput.trim();
    if ((!trimmed && attachedFiles.length === 0) || isLoading || !activeThreadId) return;

    let backendInput = trimmed;
    const attachmentNames = attachedFiles.map((f) => f.filename);

    if (attachedFiles.length > 0) {
      const fileSections = attachedFiles
        .map((f) => `[Attached file: ${f.filename}]\n${f.content}`)
        .join("\n\n---\n\n");
      backendInput = trimmed
        ? `${fileSections}\n\n---\n\nUser message: ${trimmed}`
        : fileSections;
    }

    setUserInput("");
    setAttachedFiles([]);
    setUploadError(null);
    await callChatApi(
      backendInput,
      trimmed || attachmentNames.map((n) => `📎 ${n}`).join("\n"),
      attachmentNames
    );
  };

  // ── Questionnaire submit ────────────────────────────────────────────────
  const handleFormSubmit = useCallback(
    async (formattedAnswers: string) => { await callChatApi(formattedAnswers, formattedAnswers, []); },
    [callChatApi]
  );

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); sendMessage(); };
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // ── File upload ─────────────────────────────────────────────────────────
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    e.target.value = "";
    setUploadError(null);
    setIsUploading(true);

    for (const file of files) {
      const formData = new FormData();
      formData.append("file", file);
      try {
        const res = await fetch(`${API_BASE}/api/upload`, { method: "POST", body: formData });
        if (!res.ok) {
          await throwApiError(res);
        }
        const data: UploadApiResponse = await res.json();
        setAttachedFiles((prev) => [...prev, { filename: data.filename, content: data.content }]);
      } catch (err: unknown) {
        setUploadError(`Upload failed for "${file.name}": ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    }
    setIsUploading(false);
  };

  const removeAttachment = (filename: string) =>
    setAttachedFiles((prev) => prev.filter((f) => f.filename !== filename));

  const canSend =
    !isLoading && !isUploading && !!activeThreadId &&
    (userInput.trim().length > 0 || attachedFiles.length > 0);

  // Whether availability data is loaded and meaningful (backend was reachable)
  const hasAvailabilityData = !checkingModels && availableModels.length > 0;
  const isModelAvailable = (val: string) =>
    !hasAvailabilityData || availableModels.includes(val);
  const onlyOneAvailable = hasAvailabilityData && availableModels.length === 1;

  // ── Chat ReactMarkdown components ────────────────────────────────────────
  const chatMarkdownComponents = buildMarkdownComponents(handleFormSubmit);

  const activeProject = projects.find((p) => p.id === activeThreadId);

  // Whether the export button should be shown
  const canExport = !!activeThreadId && (!!prdDraft || !!architectureDraft || !!userStoriesDraft);
  const activeStageTitle =
    activeWorkspaceStage === "prd"
      ? "PRD"
      : activeWorkspaceStage === "architecture"
      ? "Architecture"
      : "User Stories";
  const stageCards: {
    key: WorkspaceStage;
    title: string;
    subtitle: string;
    ready: boolean;
    accent: string;
  }[] = [
    {
      key: "prd",
      title: "PRD",
      subtitle: isReady ? "Ready for downstream work" : prdDraft ? "Draft in progress" : "Waiting for requirements",
      ready: !!prdDraft,
      accent: "from-amber-500 to-orange-500",
    },
    {
      key: "architecture",
      title: "Architecture",
      subtitle: architectureDraft ? "Technical design ready" : isReady ? "Ready to generate" : "Blocked by PRD",
      ready: !!architectureDraft,
      accent: "from-indigo-500 to-violet-500",
    },
    {
      key: "stories",
      title: "User Stories",
      subtitle: userStoriesDraft ? "Delivery planning ready" : architectureDraft ? "Ready to generate" : "Blocked by architecture",
      ready: !!userStoriesDraft,
      accent: "from-emerald-500 to-teal-500",
    },
  ];

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden">

      {/* ================================================================ */}
      {/* SIDEBAR                                                           */}
      {/* ================================================================ */}
      <div
        className={`flex flex-col shrink-0 border-r border-zinc-800 bg-zinc-900 transition-all duration-200 overflow-hidden ${
          sidebarOpen ? "w-64" : "w-12"
        }`}
      >
        {/* Sidebar top bar */}
        <div className={`flex items-center border-b border-zinc-800 shrink-0 ${sidebarOpen ? "px-4 py-4" : "px-0 py-3 justify-center"}`}>
          {sidebarOpen && (
            <div className="flex items-center gap-2.5 flex-1 min-w-0 mr-2">
              <div className="w-6 h-6 rounded-md bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shrink-0 shadow-md shadow-indigo-900/40">
                <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                </svg>
              </div>
              <span className="text-sm font-bold bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent truncate">
                AI Factory
              </span>
            </div>
          )}
          {/* Toggle button */}
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="w-7 h-7 rounded-md flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors shrink-0"
            aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            {sidebarOpen ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7M19 19l-7-7 7-7" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              </svg>
            )}
          </button>
        </div>

        {/* New Project button */}
        <div className={`shrink-0 border-b border-zinc-800 ${sidebarOpen ? "px-4 py-3" : "px-2 py-3"}`}>
          {sidebarOpen ? (
            <button onClick={createProject}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-colors shadow-md shadow-indigo-900/30">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Project
            </button>
          ) : (
            <button onClick={createProject} title="New Project"
              className="w-8 h-8 mx-auto flex items-center justify-center rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors shadow-md shadow-indigo-900/30">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          )}
        </div>

        {/* Project list */}
        <div className="flex-1 overflow-y-auto py-2">
          {projects.length === 0 && sidebarOpen && (
            <div className="px-4 py-8 text-center">
              <div className="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center mx-auto mb-3">
                <svg className="w-5 h-5 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
              </div>
              <p className="text-xs text-zinc-600">No projects yet.</p>
              <p className="text-xs text-zinc-700 mt-1">Click "New Project" to start.</p>
            </div>
          )}

          {projects.map((project) => {
            const isActive = project.id === activeThreadId;
            const isDeleting = deletingId === project.id;
            const initial = project.name.charAt(0).toUpperCase();

            return (
              <div
                key={project.id}
                onClick={() => selectProject(project.id)}
                title={!sidebarOpen ? project.name : undefined}
                className={`w-full text-left flex items-center cursor-pointer transition-colors group ${
                  sidebarOpen ? "gap-2.5 px-3 py-2" : "justify-center py-2"
                } ${
                  isActive
                    ? "bg-zinc-800 border-l-2 border-indigo-400"
                    : "border-l-2 border-transparent hover:bg-zinc-800/50"
                }`}
              >
                {/* Avatar */}
                <div className={`rounded-md flex items-center justify-center shrink-0 text-xs font-bold text-white shadow-sm ${
                  sidebarOpen ? "w-6 h-6" : "w-7 h-7"
                } ${
                  isActive
                    ? "bg-gradient-to-br from-indigo-500 to-violet-600 shadow-indigo-900/40"
                    : "bg-zinc-700 group-hover:bg-zinc-600"
                }`}>
                  {isDeleting ? <Spinner className="w-3 h-3" /> : initial}
                </div>

                {/* Name + delete button — only in expanded mode */}
                {sidebarOpen && (
                  <>
                    <span className={`text-sm truncate flex-1 ${
                      isActive ? "text-zinc-100 font-medium" : "text-zinc-400 group-hover:text-zinc-200"
                    }`}>
                      {project.name}
                    </span>

                    {/* Delete button — visible on hover */}
                    <button
                      type="button"
                      onClick={(e) => deleteProject(e, project.id)}
                      disabled={isDeleting}
                      title="Delete project"
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0 w-5 h-5 rounded flex items-center justify-center text-zinc-600 hover:text-red-400 hover:bg-red-950/50 transition-all disabled:cursor-not-allowed"
                      aria-label={`Delete ${project.name}`}
                    >
                      {isDeleting ? (
                        <Spinner className="w-3 h-3" />
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      )}
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Sidebar footer */}
        <div className={`border-t border-zinc-800 shrink-0 ${sidebarOpen ? "px-4 py-3" : "px-2 py-3"}`}>
          {sidebarOpen ? (
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-zinc-700">
                {projects.length} project{projects.length !== 1 ? "s" : ""}
              </p>
              <Link
                href="/settings"
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                title="Integration settings"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Settings
              </Link>
            </div>
          ) : (
            <Link
              href="/settings"
              title="Settings"
              className="w-8 h-8 mx-auto flex items-center justify-center rounded-lg text-zinc-600 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </Link>
          )}
        </div>
      </div>

      {/* ================================================================ */}
      {/* CHAT PANE                                                         */}
      {/* ================================================================ */}
      <div className="flex flex-col flex-1 border-r border-zinc-800 bg-zinc-950 min-w-0">
        {/* Chat header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`w-2 h-2 rounded-full shrink-0 ${activeThreadId ? "bg-emerald-400 shadow-sm shadow-emerald-400/50" : "bg-zinc-600"}`}
              style={activeThreadId ? { animation: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite" } : undefined} />
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-zinc-100 truncate">
                {activeProject ? activeProject.name : "SA Agent"}
              </h1>
              {activeProject && (
                <p className="text-[10px] text-zinc-600 font-mono truncate">{activeThreadId}</p>
              )}
            </div>
          </div>

          {/* Model selector */}
          <div className="flex items-center gap-2 shrink-0">
            <label htmlFor="model-select" className="text-xs text-zinc-500 shrink-0">Model:</label>
            {checkingModels ? (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg">
                <Spinner className="w-3 h-3 text-zinc-500" />
                <span className="text-xs text-zinc-500">Checking…</span>
              </div>
            ) : onlyOneAvailable ? (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${modelDot(modelChoice)}`} />
                <span className={`text-xs font-medium ${modelColor(modelChoice)}`}>{modelLabel(modelChoice)}</span>
              </div>
            ) : (
              <div className="relative">
                <select
                  id="model-select"
                  value={modelChoice}
                  onChange={(e) => setModelChoice(e.target.value as ModelChoice)}
                  disabled={isLoading}
                  className="appearance-none bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs font-medium rounded-lg pl-3 pr-7 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors hover:border-zinc-600"
                >
                  {MODEL_OPTIONS.map((opt) => {
                    const avail = isModelAvailable(opt.value);
                    return (
                      <option key={opt.value} value={opt.value} disabled={!avail}>
                        {opt.label}{!avail ? " (unavailable)" : ""}
                      </option>
                    );
                  })}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
                  <svg className="w-3 h-3 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            )}
            {!checkingModels && (
              <span className={`w-2 h-2 rounded-full shrink-0 shadow-sm ${modelDot(modelChoice)}`} />
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          {/* No project */}
          {!activeThreadId && !isHydrating && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center select-none">
              <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                <svg className="w-8 h-8 text-zinc-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
              </div>
              <div>
                <p className="text-zinc-400 font-medium text-sm">No project selected</p>
                <p className="text-zinc-600 text-xs mt-1">Create a new project from the sidebar to get started.</p>
              </div>
            </div>
          )}

          {/* Hydrating */}
          {isHydrating && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Spinner className="w-6 h-6 text-indigo-400" />
              <p className="text-xs text-zinc-500">Loading conversation…</p>
            </div>
          )}

          {/* Feature B — PRD Amendment Mode banner */}
          {!isHydrating && isReady && !amendmentBannerDismissed && (
            <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/80 border border-emerald-800/40 rounded-xl text-xs text-emerald-400 shrink-0">
              <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd" />
              </svg>
              <span className="flex-1">PRD finalized — you can still chat to amend it</span>
              <button
                type="button"
                onClick={() => setAmendmentBannerDismissed(true)}
                className="shrink-0 text-emerald-600 hover:text-emerald-300 transition-colors leading-none"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          )}

          {/* Welcome message for empty sessions */}
          {!isHydrating && activeThreadId && messages.length === 0 && (
            <div className="flex justify-start min-w-0">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-[10px] font-bold text-white mr-2 mt-0.5 shrink-0 shadow-md shadow-indigo-900/40">
                SA
              </div>
              <div className="max-w-[85%] min-w-0 overflow-x-hidden bg-zinc-800 text-zinc-200 rounded-2xl rounded-bl-sm px-4 py-3 text-sm leading-relaxed border border-zinc-700/50">
                <p>
                  Hello! I'm your{" "}
                  <strong className="text-indigo-300 font-semibold">System Analyst (SA) Agent</strong> for{" "}
                  <strong className="text-indigo-300 font-semibold">{activeProject?.name ?? "this session"}</strong>.
                </p>
                <p className="mt-1.5">
                  Describe the software you want to build and I'll help clarify requirements into a PRD.
                  You can also <strong className="text-indigo-300 font-semibold">attach files</strong> (Excel, Word, PDF, Markdown) for context.
                </p>
              </div>
            </div>
          )}

          {/* Message list */}
          {!isHydrating && messages.map((msg, idx) => (
            <div key={idx} className={`flex min-w-0 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" && (
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-[10px] font-bold text-white mr-2 mt-0.5 shrink-0 shadow-md shadow-indigo-900/40">
                  SA
                </div>
              )}

              <div className="flex flex-col gap-1 max-w-[85%] min-w-0 overflow-x-hidden">
                {msg.role === "assistant" && msg.model && <ModelBadge model={msg.model} />}

                {/* Attachment badges */}
                {msg.role === "user" && msg.attachments && msg.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-1 justify-end mb-1">
                    {msg.attachments.map((name) => (
                      <span key={name}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-950/60 border border-indigo-700/40 text-[10px] text-indigo-300">
                        {fileIcon(name)}{" "}
                        <span className="max-w-[140px] truncate">{name}</span>
                      </span>
                    ))}
                  </div>
                )}

                <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed max-w-full overflow-x-hidden ${
                  msg.role === "user"
                    ? "bg-indigo-600 text-white rounded-br-sm shadow-md shadow-indigo-900/30"
                    : "bg-zinc-800 text-zinc-100 rounded-bl-sm border border-zinc-700/50"
                }`}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={chatMarkdownComponents as never}>
                    {msg.content}
                  </ReactMarkdown>
                </div>

                {msg.role === "user" && msg.model && (
                  <div className="flex justify-end"><ModelBadge model={msg.model} /></div>
                )}
              </div>

              {msg.role === "user" && (
                <div className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center text-[10px] font-bold text-zinc-300 ml-2 mt-0.5 shrink-0">
                  U
                </div>
              )}
            </div>
          ))}

          {/* Thinking indicator */}
          {isLoading && (
            <div className="flex justify-start min-w-0">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-[10px] font-bold text-white mr-2 mt-0.5 shrink-0 shadow-md shadow-indigo-900/40">
                SA
              </div>
              <div className="flex flex-col gap-1">
                <ModelBadge model={modelChoice} />
                <div className="bg-zinc-800 border border-zinc-700/50 rounded-2xl rounded-bl-sm px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0ms]" />
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:150ms]" />
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-950/50 border border-red-800/60 rounded-xl px-4 py-3 text-sm text-red-300">
              <span className="font-semibold">Error: </span>{error}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="px-5 pt-3 pb-4 border-t border-zinc-800 bg-zinc-900/80 shrink-0">
          {/* Upload error */}
          {uploadError && (
            <div className="mb-2 flex items-start gap-2 bg-red-950/40 border border-red-800/50 rounded-lg px-3 py-2 text-xs text-red-300">
              <span className="shrink-0 mt-0.5">⚠</span>
              <span className="flex-1">{uploadError}</span>
              <button type="button" onClick={() => setUploadError(null)}
                className="shrink-0 text-red-400 hover:text-red-200 transition-colors">×</button>
            </div>
          )}

          {/* Attached file chips */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {attachedFiles.map((f) => (
                <AttachmentChip key={f.filename} filename={f.filename}
                  onRemove={() => removeAttachment(f.filename)} />
              ))}
            </div>
          )}

          {/* Uploading */}
          {isUploading && (
            <div className="flex items-center gap-2 mb-2 text-xs text-indigo-400">
              <Spinner className="w-3.5 h-3.5" />
              Extracting file content…
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex gap-2 items-end">
            <input ref={fileInputRef} type="file" accept={ACCEPTED_EXTENSIONS}
              multiple className="hidden" onChange={handleFileChange} />

            {/* Paperclip */}
            <button type="button" onClick={() => fileInputRef.current?.click()}
              disabled={isLoading || isUploading || !activeThreadId}
              title="Attach file (Excel, Word, PDF, Markdown)"
              className="flex items-center justify-center w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-500 hover:text-indigo-400 hover:border-indigo-600/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>

            <textarea
              ref={textareaRef}
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                !activeThreadId
                  ? "Select or create a project first…"
                  : attachedFiles.length > 0
                  ? "Add a message about the attached files… (optional)"
                  : "Describe your requirements… (Enter to send, Shift+Enter for newline)"
              }
              disabled={isLoading || !activeThreadId}
              rows={1}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            />

            <button type="submit" disabled={!canSend}
              className="px-5 py-3 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 disabled:from-zinc-700 disabled:to-zinc-700 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-all shrink-0 shadow-md shadow-indigo-900/30 disabled:shadow-none">
              {isLoading ? (
                <span className="flex items-center gap-2"><Spinner />Thinking</span>
              ) : (
                "Send"
              )}
            </button>
          </form>

          <div className="flex items-center justify-between mt-2">
            <p className="text-[10px] text-zinc-700 truncate font-mono">{activeThreadId ?? "—"}</p>
            <p className="text-[10px] text-zinc-600 shrink-0 ml-2">
              <span className={`font-mono font-semibold ${modelColor(modelChoice)}`}>
                {modelLabel(modelChoice)}
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* ================================================================ */}
      {/* RIGHT PANE — WORKSPACE                                            */}
      {/* ================================================================ */}
      <div className="flex flex-col flex-1 bg-zinc-900 min-w-0">
        <div className="relative border-b border-zinc-800 shrink-0">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-500/40 to-transparent" />
          <div className="px-5 py-4 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">Workspace</p>
                <h2 className="text-base font-semibold text-zinc-100">{activeStageTitle}</h2>
              </div>
              {canExport && (
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={isExporting}
                  className="flex items-center gap-2 px-3 py-2 bg-zinc-800 border border-zinc-700 hover:border-indigo-500/60 hover:bg-indigo-950/30 rounded-lg text-xs text-zinc-300 transition-colors disabled:opacity-50"
                >
                  {isExporting ? <Spinner className="w-3 h-3" /> : null}
                  Export Project
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {stageCards.map((stage) => (
                <button
                  key={stage.key}
                  type="button"
                  onClick={() => setActiveWorkspaceStage(stage.key)}
                  className={`rounded-2xl border px-4 py-3 text-left transition-all ${
                    activeWorkspaceStage === stage.key
                      ? "border-zinc-500 bg-zinc-800/90 shadow-lg shadow-black/20"
                      : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-700 hover:bg-zinc-800/60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-zinc-100">{stage.title}</p>
                      <p className="mt-1 text-xs text-zinc-500">{stage.subtitle}</p>
                    </div>
                    <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ${stage.accent} text-[11px] font-bold text-white`}>
                      {stage.key === "prd" ? "PRD" : stage.key === "architecture" ? "ARC" : "USR"}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-[11px] text-zinc-500">
                    <span className={`h-2 w-2 rounded-full ${stage.ready ? "bg-emerald-400" : "bg-zinc-700"}`} />
                    {stage.ready ? "Available" : "Pending"}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {activeWorkspaceStage === "prd" && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-zinc-100">PRD Workspace</h3>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${isReady ? "border border-emerald-700/50 bg-emerald-950/60 text-emerald-300" : prdDraft ? "border border-amber-700/50 bg-amber-950/60 text-amber-300" : "border border-zinc-700 bg-zinc-800 text-zinc-400"}`}>
                    {isReady ? "Ready" : prdDraft ? "Draft" : "Empty"}
                  </span>
                  <div className="ml-auto flex flex-wrap gap-2">
                    {prdDraft && !isEditingPrd && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingPrdContent(prdDraft);
                          setIsEditingPrd(true);
                        }}
                        className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-300 transition-colors hover:border-amber-600/60 hover:text-amber-300"
                      >
                        Edit Directly
                      </button>
                    )}
                    {prdDraft && (
                      <button
                        type="button"
                        onClick={handleResetPrd}
                        disabled={isResettingPrd}
                        className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-300 transition-colors hover:border-red-600/60 hover:text-red-300 disabled:opacity-50"
                      >
                        {isResettingPrd ? "Resetting…" : "Reset PRD"}
                      </button>
                    )}
                  </div>
                </div>

                {prdDraft ? (
                  <p className="mt-2 text-xs text-zinc-500">
                    This stage owns scope and requirements. Any PRD revision will clear downstream Architecture and User Stories.
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-zinc-500">
                    Use the chat on the left to clarify requirements. Once the PRD appears, you can revise it here stage-by-stage.
                  </p>
                )}
              </div>

              {prdDraft && (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold text-zinc-100">AI Revision</h4>
                      <p className="mt-1 text-xs text-zinc-500">Ask AI to revise only the PRD. Example: add audit log requirements, remove offline mode, split admin roles.</p>
                    </div>
                    <button
                      type="button"
                      onClick={handleRefinePrd}
                      disabled={isRefiningPrd || !prdInstruction.trim()}
                      className="rounded-lg bg-gradient-to-r from-amber-600 to-orange-500 px-4 py-2 text-xs font-semibold text-white transition-all disabled:cursor-not-allowed disabled:from-zinc-700 disabled:to-zinc-700"
                    >
                      {isRefiningPrd ? "Applying…" : "Apply PRD Revision"}
                    </button>
                  </div>
                  <textarea
                    value={prdInstruction}
                    onChange={(e) => setPrdInstruction(e.target.value)}
                    rows={4}
                    placeholder="Describe what to change in the PRD for this stage only…"
                    className="mt-4 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                  />
                </div>
              )}

              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/30 p-5">
                {isEditingPrd ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
                      Saving PRD changes will clear Architecture and User Stories because they depend on this stage.
                    </div>
                    <textarea
                      value={editingPrdContent}
                      onChange={(e) => setEditingPrdContent(e.target.value)}
                      rows={24}
                      className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 font-mono text-sm text-zinc-100 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setIsEditingPrd(false)}
                        className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-300"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSavePrd}
                        disabled={isSavingPrd || !editingPrdContent.trim()}
                        className="rounded-lg bg-gradient-to-r from-amber-600 to-orange-500 px-5 py-2 text-sm font-semibold text-white disabled:from-zinc-700 disabled:to-zinc-700"
                      >
                        {isSavingPrd ? "Saving…" : "Save PRD"}
                      </button>
                    </div>
                  </div>
                ) : prdDraft ? (
                  <div className="prose prose-invert prose-sm max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={prdMarkdownComponents as never}>
                      {prdDraft}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                    <p className="text-sm font-medium text-zinc-400">No PRD yet</p>
                    <p className="max-w-sm text-xs text-zinc-600">Start with the chat on the left. This panel becomes the dedicated PRD workspace once requirements are captured.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeWorkspaceStage === "architecture" && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-zinc-100">Architecture Workspace</h3>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${architectureDraft ? "border border-violet-700/50 bg-violet-950/60 text-violet-300" : isReady ? "border border-indigo-700/50 bg-indigo-950/60 text-indigo-300" : "border border-zinc-700 bg-zinc-800 text-zinc-400"}`}>
                    {architectureDraft ? "Generated" : isReady ? "Ready to generate" : "Blocked"}
                  </span>
                  <div className="ml-auto flex flex-wrap gap-2">
                    {architectureDraft && !isEditingArch && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingArchContent(architectureDraft);
                            setIsEditingArch(true);
                          }}
                          className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-300 transition-colors hover:border-amber-600/60 hover:text-amber-300"
                        >
                          Edit Directly
                        </button>
                        <button
                          type="button"
                          onClick={handleRegenerateArchitecture}
                          className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-300 transition-colors hover:border-indigo-500/60 hover:text-indigo-300"
                        >
                          Regenerate
                        </button>
                      </>
                    )}
                    {!architectureDraft && isReady && !isGeneratingArch && (
                      <button
                        type="button"
                        onClick={handleGenerateArchitecture}
                        className="rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2 text-xs font-semibold text-white"
                      >
                        Generate Architecture
                      </button>
                    )}
                  </div>
                </div>

                {!isReady ? (
                  <p className="mt-2 text-xs text-zinc-500">Finalize the PRD first. Architecture is intentionally isolated so you can revise it without mixing it into PRD preview.</p>
                ) : architectureDraft ? (
                  <p className="mt-2 text-xs text-zinc-500">This stage owns technical design. Updating architecture clears User Stories because the delivery plan depends on it.</p>
                ) : (
                  <p className="mt-2 text-xs text-zinc-500">The PRD is ready. Generate architecture here when you want to move into solution design.</p>
                )}
              </div>

              {architectureDraft && !isEditingArch && (
                <StageChatPanel
                  stage="architecture"
                  accentColor="indigo"
                  messages={archChatMessages}
                  input={archChatInput}
                  isSending={isSendingArchChat}
                  onInputChange={setArchChatInput}
                  onSend={() => handleStageChatSend("architecture")}
                  placeholder="Ask about or request changes to the architecture… (e.g. add Redis cache, explain the API gateway choice)"
                />
              )}

              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/30 p-5">
                {isGeneratingArch ? (
                  <div className="flex flex-col items-center gap-3 py-12 text-center">
                    <Spinner className="w-7 h-7 text-indigo-400" />
                    <p className="text-sm text-zinc-300">Architect is designing the system…</p>
                  </div>
                ) : isEditingArch ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
                      Saving architecture changes will clear User Stories.
                    </div>
                    <textarea
                      value={editingArchContent}
                      onChange={(e) => setEditingArchContent(e.target.value)}
                      rows={24}
                      className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 font-mono text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setIsEditingArch(false)}
                        className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-300"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveArchitecture}
                        disabled={isSavingArch || !editingArchContent.trim()}
                        className="rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-2 text-sm font-semibold text-white disabled:from-zinc-700 disabled:to-zinc-700"
                      >
                        {isSavingArch ? "Saving…" : "Save Architecture"}
                      </button>
                    </div>
                  </div>
                ) : architectureDraft ? (
                  <div className="prose prose-invert prose-sm max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={prdMarkdownComponents as never}>
                      {architectureDraft}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                    <p className="text-sm font-medium text-zinc-400">{isReady ? "Architecture not generated yet" : "Architecture is blocked"}</p>
                    <p className="max-w-sm text-xs text-zinc-600">
                      {isReady
                        ? "Generate architecture from the finalized PRD in this workspace."
                        : "This stage becomes available after the PRD is ready."}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeWorkspaceStage === "stories" && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-zinc-100">User Stories Workspace</h3>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${userStoriesDraft ? "border border-emerald-700/50 bg-emerald-950/60 text-emerald-300" : architectureDraft ? "border border-teal-700/50 bg-teal-950/60 text-teal-300" : "border border-zinc-700 bg-zinc-800 text-zinc-400"}`}>
                    {userStoriesDraft ? "Generated" : architectureDraft ? "Ready to generate" : "Blocked"}
                  </span>
                  <div className="ml-auto flex flex-wrap gap-2">
                    {userStoriesDraft && !isEditingStories && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingStoriesContent(userStoriesDraft);
                            setIsEditingStories(true);
                          }}
                          className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-300 transition-colors hover:border-amber-600/60 hover:text-amber-300"
                        >
                          Edit Directly
                        </button>
                        <button
                          type="button"
                          onClick={handleRegenerateUserStories}
                          className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-300 transition-colors hover:border-emerald-500/60 hover:text-emerald-300"
                        >
                          Regenerate
                        </button>
                      </>
                    )}
                    {!userStoriesDraft && architectureDraft && !isGeneratingStories && (
                      <button
                        type="button"
                        onClick={handleGenerateUserStories}
                        className="rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-xs font-semibold text-white"
                      >
                        Generate User Stories
                      </button>
                    )}
                  </div>
                </div>

                {!architectureDraft ? (
                  <p className="mt-2 text-xs text-zinc-500">Generate or revise Architecture first. This stage is reserved for delivery planning, not mixed into technical design.</p>
                ) : userStoriesDraft ? (
                  <p className="mt-2 text-xs text-zinc-500">This stage owns the delivery-ready backlog. You can refine stories here before pushing them to Jira or GitHub.</p>
                ) : (
                  <p className="mt-2 text-xs text-zinc-500">Architecture is ready. Generate the initial user stories set here.</p>
                )}
              </div>

              {userStoriesDraft && !isEditingStories && (
                <StageChatPanel
                  stage="stories"
                  accentColor="emerald"
                  messages={storiesChatMessages}
                  input={storiesChatInput}
                  isSending={isSendingStoriesChat}
                  onInputChange={setStoriesChatInput}
                  onSend={() => handleStageChatSend("stories")}
                  placeholder="Ask about or request changes to the stories… (e.g. add admin stories, tighten acceptance criteria)"
                />
              )}

              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/30 p-5">
                {isGeneratingStories ? (
                  <div className="flex flex-col items-center gap-3 py-12 text-center">
                    <Spinner className="w-7 h-7 text-emerald-400" />
                    <p className="text-sm text-zinc-300">Writing user stories and acceptance criteria…</p>
                  </div>
                ) : isEditingStories ? (
                  <div className="space-y-3">
                    <textarea
                      value={editingStoriesContent}
                      onChange={(e) => setEditingStoriesContent(e.target.value)}
                      rows={24}
                      className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 font-mono text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setIsEditingStories(false)}
                        className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-300"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveUserStories}
                        disabled={isSavingStories || !editingStoriesContent.trim()}
                        className="rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-2 text-sm font-semibold text-white disabled:from-zinc-700 disabled:to-zinc-700"
                      >
                        {isSavingStories ? "Saving…" : "Save User Stories"}
                      </button>
                    </div>
                  </div>
                ) : userStoriesDraft ? (
                  <>
                    {deliveryPushResult && (
                      <div className="mb-4 flex items-start gap-2 rounded-xl border border-blue-700/50 bg-blue-950/40 px-4 py-3 text-sm">
                        <svg className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-blue-300">
                            {deliveryPushResult.count} item{deliveryPushResult.count !== 1 ? "s" : ""} published to {deliveryPushResult.target === "jira" ? "Jira" : "GitHub"}
                          </p>
                          <p className="mt-0.5 break-all font-mono text-xs text-blue-500">
                            {deliveryPushResult.items.join(" · ")}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setDeliveryPushResult(null)}
                          className="text-blue-600 transition-colors hover:text-blue-300"
                        >
                          ×
                        </button>
                      </div>
                    )}

                    <div className="mb-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openDeliveryModal("jira")}
                        disabled={isPublishingDelivery}
                        className="rounded-lg border border-blue-700/60 bg-blue-900/50 px-3 py-2 text-xs font-semibold text-blue-300 transition-colors hover:border-blue-500/70 hover:bg-blue-800/60 disabled:opacity-50"
                      >
                        {isPublishingDelivery && deliveryTarget === "jira" ? "Publishing…" : "Push to Jira"}
                      </button>
                      <button
                        type="button"
                        onClick={() => openDeliveryModal("github")}
                        disabled={isPublishingDelivery}
                        className="rounded-lg border border-zinc-600 bg-zinc-900/70 px-3 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:border-zinc-400 hover:bg-zinc-800 disabled:opacity-50"
                      >
                        {isPublishingDelivery && deliveryTarget === "github" ? "Publishing…" : "Create GitHub Issues"}
                      </button>
                    </div>

                    <div className="prose prose-invert prose-sm max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={prdMarkdownComponents as never}>
                        {userStoriesDraft}
                      </ReactMarkdown>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                    <p className="text-sm font-medium text-zinc-400">{architectureDraft ? "User stories not generated yet" : "User stories are blocked"}</p>
                    <p className="max-w-sm text-xs text-zinc-600">
                      {architectureDraft
                        ? "Generate the backlog here after you are happy with the architecture."
                        : "This stage becomes available after the architecture is ready."}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ================================================================ */}
      {/* DELIVERY MODAL                                                    */}
      {/* ================================================================ */}
      {showDeliveryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-md bg-zinc-800 border border-zinc-700 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-700 bg-gradient-to-r from-blue-950/60 to-indigo-950/40">
              <div className="w-8 h-8 rounded-lg bg-blue-600/80 flex items-center justify-center shrink-0">
                {deliveryTarget === "jira" ? (
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 .5C5.648.5.5 5.648.5 12a11.5 11.5 0 008 10.938c.6.112.82-.262.82-.582 0-.288-.01-1.05-.016-2.062-3.252.706-3.938-1.568-3.938-1.568-.532-1.35-1.3-1.71-1.3-1.71-1.062-.726.08-.712.08-.712 1.174.082 1.792 1.206 1.792 1.206 1.044 1.79 2.738 1.272 3.406.972.106-.756.41-1.272.744-1.564-2.596-.296-5.326-1.298-5.326-5.776 0-1.276.456-2.32 1.204-3.138-.12-.296-.522-1.49.114-3.106 0 0 .982-.314 3.218 1.2A11.2 11.2 0 0112 6.174c.996.004 2 .134 2.938.394 2.234-1.514 3.214-1.2 3.214-1.2.638 1.616.236 2.81.116 3.106.75.818 1.202 1.862 1.202 3.138 0 4.49-2.734 5.476-5.338 5.766.42.362.794 1.078.794 2.172 0 1.568-.014 2.832-.014 3.218 0 .322.216.698.826.58A11.502 11.502 0 0023.5 12C23.5 5.648 18.352.5 12 .5z" />
                  </svg>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold text-zinc-100">
                  {deliveryTarget === "jira" ? "Publish to Jira" : "Create GitHub Issues"}
                </h3>
                <p className="text-xs text-zinc-500">Choose a delivery target and publish the generated user stories</p>
              </div>
              <button
                type="button"
                onClick={() => setShowDeliveryModal(false)}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* Target selector */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    setDeliveryTarget("jira");
                    setDeliveryErrorMsg(null);
                    // Auto-fetch projects if not loaded yet
                    if (jiraProjects.length === 0 && isJiraConfigured() && jiraToken) {
                      setIsLoadingJiraProjects(true);
                      setJiraProjectsFetchFailed(false);
                      try {
                        const params = new URLSearchParams({ domain: jiraConfig.domain, email: jiraConfig.email, token: jiraToken });
                        const res = await fetch(`${API_BASE}/api/jira/projects?${params}`);
                        if (res.ok) {
                          const { projects: list } = await res.json();
                          setJiraProjects(list);
                          if (!selectedJiraProjectKey && list.length > 0) setSelectedJiraProjectKey(list[0].key);
                        } else {
                          setJiraProjectsFetchFailed(true);
                        }
                      } catch { setJiraProjectsFetchFailed(true); } finally {
                        setIsLoadingJiraProjects(false);
                      }
                    }
                  }}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${deliveryTarget === "jira" ? "bg-blue-600 text-white" : "bg-zinc-900 text-zinc-400 border border-zinc-700 hover:text-zinc-200"}`}
                >
                  Jira
                </button>
                <button
                  type="button"
                  onClick={() => { setDeliveryTarget("github"); setDeliveryErrorMsg(null); }}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${deliveryTarget === "github" ? "bg-zinc-200 text-zinc-950" : "bg-zinc-900 text-zinc-400 border border-zinc-700 hover:text-zinc-200"}`}
                >
                  GitHub
                </button>
              </div>

              {/* Configuration status */}
              {deliveryTarget === "jira" ? (
                isJiraConfigured() ? (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/30 px-4 py-3 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                        <p className="text-xs font-semibold text-emerald-300">Jira configured</p>
                      </div>
                      <p className="text-xs text-zinc-500 font-mono">{jiraConfig.domain}</p>
                    </div>
                    {/* Project selector */}
                    <div>
                      <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Project</label>
                      {isLoadingJiraProjects ? (
                        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-zinc-700 bg-zinc-900">
                          <Spinner className="w-3.5 h-3.5 text-zinc-500" />
                          <span className="text-xs text-zinc-500">Loading projects…</span>
                        </div>
                      ) : jiraProjects.length > 0 ? (
                        <div className="relative">
                          <select
                            value={selectedJiraProjectKey}
                            onChange={(e) => setSelectedJiraProjectKey(e.target.value)}
                            className="w-full appearance-none bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 pr-8 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                          >
                            <option value="" disabled>Select a project…</option>
                            {jiraProjects.map((p) => (
                              <option key={p.id} value={p.key}>{p.name} ({p.key})</option>
                            ))}
                          </select>
                          <div className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center">
                            <svg className="w-3.5 h-3.5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 px-3 py-2.5 flex items-start gap-2.5">
                          <svg className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-amber-300 font-medium">
                              {jiraProjectsFetchFailed ? "Could not load projects" : "No projects loaded"}
                            </p>
                            <p className="text-xs text-zinc-500 mt-0.5">
                              Go to{" "}
                              <Link href="/settings" onClick={() => setShowDeliveryModal(false)}
                                className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2">
                                Settings
                              </Link>
                              {" "}and use <span className="font-semibold text-zinc-400">Test</span> to verify your credentials.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 px-4 py-3 flex items-start gap-3">
                    <svg className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-amber-300">Jira not configured</p>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        Add your Jira domain, email, token and project key in{" "}
                        <Link href="/settings" onClick={() => setShowDeliveryModal(false)}
                          className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2">
                          Settings
                        </Link>
                        .
                      </p>
                    </div>
                  </div>
                )
              ) : (
                isGitHubConfigured() ? (
                  <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/30 px-4 py-3 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                      <p className="text-xs font-semibold text-emerald-300">GitHub configured</p>
                    </div>
                    <p className="text-xs text-zinc-500 font-mono">{githubConfig.owner}/{githubConfig.repo}</p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 px-4 py-3 flex items-start gap-3">
                    <svg className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-amber-300">GitHub not configured</p>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        Add your GitHub owner, repo and token in{" "}
                        <Link href="/settings" onClick={() => setShowDeliveryModal(false)}
                          className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2">
                          Settings
                        </Link>
                        .
                      </p>
                    </div>
                  </div>
                )
              )}

              {deliveryErrorMsg && (
                <div className="flex items-start gap-2 bg-red-950/50 border border-red-800/50 rounded-lg px-3 py-2.5 text-xs text-red-300">
                  <span className="shrink-0 mt-0.5">⚠</span>
                  <span className="flex-1 break-words">{deliveryErrorMsg}</span>
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-zinc-700/60 bg-zinc-900/50 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeliveryModal(false)}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 bg-zinc-700/50 hover:bg-zinc-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePublishDelivery}
                disabled={
                  isPublishingDelivery ||
                  (deliveryTarget === "jira" && (
                    !isJiraConfigured() ||
                    isLoadingJiraProjects ||
                    jiraProjects.length === 0 ||
                    !selectedJiraProjectKey
                  )) ||
                  (deliveryTarget === "github" && !isGitHubConfigured())
                }
                className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:from-zinc-700 disabled:to-zinc-700 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-all shadow-md shadow-blue-900/30"
              >
                {isPublishingDelivery ? (
                  <>
                    <Spinner className="w-3.5 h-3.5" />
                    Publishing…
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    Publish
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
