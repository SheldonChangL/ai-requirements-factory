# Launch Posts

Forum promotion drafts for public alpha launch.

---

## Hacker News (Show HN)

**Title:** Show HN: AI Requirements Factory – Self-hosted pipeline from product idea to Jira/GitHub stories

**Body:**

Hi HN,

I built this because most AI writing tools stop at "generate a PRD" and leave the rest to you. I wanted something that carries output forward — from requirements discovery through architecture drafts to delivery-ready user stories.

**What it does:**

- An SA-style AI agent interviews you to clarify requirements before generating anything
- Generates PRD → architecture (with Mermaid diagrams) → epic-grouped user stories
- Every stage supports manual editing, AI-assisted refinement, and review notes
- Preview delivery items before publishing to Jira or GitHub
- Accepts PDF, DOCX, XLSX, and Markdown as source inputs

**What makes it different:**

- Self-hosted — runs on your machine, your data stays local
- Works with Ollama (local models), Claude CLI, Gemini CLI, Codex CLI, or any OpenAI-compatible API
- File-based prompt profiles you can customize per team
- Model-aware context budgets so it works across small local models and large hosted ones
- Review-first workflow — no silent overwrites, every change goes through a diff

**Stack:** Next.js frontend, FastAPI + LangGraph backend, SQLite storage.

Apache-2.0 licensed. Feedback welcome — especially from teams who've tried to operationalize AI-generated requirements.

GitHub: https://github.com/SheldonChangL/ai-requirements-factory

---

## Reddit r/selfhosted

**Title:** AI Requirements Factory — self-hosted pipeline that turns product ideas into Jira/GitHub stories

**Body:**

Open-sourced my requirements pipeline tool. It's designed for engineering teams that want local control over AI-assisted product planning.

**The workflow:**
1. AI interviews you to clarify requirements (not just "describe your product")
2. Generates a structured PRD with NFRs
3. Produces architecture drafts with Mermaid diagrams
4. Creates epic-grouped user stories with acceptance criteria
5. Preview and publish directly to Jira or GitHub

**Self-hosted highlights:**
- Runs entirely on your machine — nothing phones home
- Works with local Ollama models or hosted APIs (Claude, Gemini, OpenAI-compatible)
- SQLite-backed, no external database needed
- One-command start: `./start.sh`

**Tech stack:** Next.js + FastAPI + LangGraph + SQLite

Apache-2.0 | https://github.com/SheldonChangL/ai-requirements-factory

---

## Reddit r/devops / r/programming

**Title:** Built an open-source tool that turns rough product ideas into structured user stories with AI — self-hosted, model-flexible

**Body:**

Tired of AI tools that generate a wall of text and call it a PRD? I built something more operational.

AI Requirements Factory is a staged pipeline:

- **Discover**: AI agent asks clarifying questions until requirements are solid
- **Specify**: Generates a PRD with explicit non-functional requirements
- **Design**: Architecture draft with Mermaid diagrams
- **Deliver**: User stories grouped by epic → preview → publish to Jira or GitHub

Key design decisions:
- Self-hosted, Apache-2.0
- Model-agnostic: Ollama, Claude CLI, Gemini CLI, Codex CLI, OpenAI-compatible
- File-based prompt templates — fork the `prompt_profiles/` directory and customize
- Context budget management so smaller models don't choke on long conversations
- Review-first: every AI revision shows a diff before applying

I'm not trying to replace product managers — this is for teams that already know what they want but spend too much time on the mechanical work of structuring and distributing it.

GitHub: https://github.com/SheldonChangL/ai-requirements-factory

---

## Reddit r/SideProject / r/opensource

**Title:** 🚀 Just open-sourced AI Requirements Factory — turns product ideas into Jira/GitHub-ready user stories

**Body:**

After months of building, I'm releasing this as public alpha.

**The problem:** You have a product idea. You need a PRD, architecture doc, and user stories in Jira. That's hours of mechanical writing even when you already know what to build.

**The solution:** A self-hosted AI pipeline that:
- Interviews you to clarify requirements (not just a text box)
- Generates PRD → architecture → user stories in a staged workflow
- Lets you edit, refine with AI, and review changes before applying
- Publishes to Jira or GitHub with a preview step

**Why self-hosted?**
- Your requirements are sensitive — keep them on your machine
- Use your own models (Ollama for local, or any hosted API)
- Customize prompt templates for your team's style

Stack: Next.js, FastAPI, LangGraph, SQLite. Apache-2.0.

Would love feedback from anyone who's tried to automate the requirements → delivery gap.

GitHub: https://github.com/SheldonChangL/ai-requirements-factory

---

## Dev.to / Hashnode blog post (longer form)

**Title:** I built a self-hosted AI pipeline that turns product ideas into Jira-ready user stories

**Body:**

### The problem

Every AI product tool I tried had the same issue: it generates a document and stops. You still have to manually structure it, break it into stories, and push those stories into your tracker. The "last mile" from AI output to actual team work is still manual.

### What I built

AI Requirements Factory is an open-source, self-hosted tool that handles the full pipeline:

1. **Discovery** — An AI agent plays the role of a systems analyst. It asks structured follow-up questions until your requirements are actually clear, rather than accepting vague input and hallucinating details.

2. **Specification** — Once requirements are solid, it generates a PRD that explicitly covers non-functional requirements, constraints, and assumptions.

3. **Design** — An architecture draft with Mermaid diagrams. Editable. Supports AI-assisted refinement with diff review.

4. **Delivery** — User stories grouped by epic, with acceptance criteria and story points. You preview the delivery items, then publish directly to Jira or GitHub.

### Design principles

**Self-hosted by default.** Product requirements are often the most sensitive documents in an organization. This runs on your machine. SQLite storage, no external services required.

**Model-flexible.** Use a local Ollama model for air-gapped environments, or connect to Claude, Gemini, Codex, or any OpenAI-compatible API. The backend manages context budgets per model so smaller models don't fail on long conversations.

**Review-first.** Every AI-generated change shows a diff. You review and approve before it's applied. No silent overwrites.

**Customizable prompts.** Prompt templates are Markdown files in a directory. Copy the default profile, edit the files, set an environment variable — done. No code changes needed.

### Tech stack

- **Frontend:** Next.js
- **Backend:** FastAPI with LangGraph for workflow state management
- **Storage:** SQLite with checkpoint-based persistence
- **Integrations:** Jira REST API, GitHub REST API

### Who this is for

- Engineering managers who want structured requirements without the overhead
- Internal tooling teams evaluating AI-assisted workflows
- Solution architects who need architecture docs alongside stories
- Teams that already use Jira or GitHub and want a smoother path from idea to backlog

### Current state

Public alpha. The core workflow is end-to-end functional. Stage editing, review notes, revision history, and delivery publishing all work. The next phase focuses on team collaboration (user identity, concurrent edit protection) and workflow extensibility.

Apache-2.0 licensed. Contributions welcome.

GitHub: https://github.com/SheldonChangL/ai-requirements-factory

---

## Twitter / X thread

**1/6** Just open-sourced AI Requirements Factory — a self-hosted pipeline that turns product ideas into Jira/GitHub-ready user stories.

Not another "generate a PRD" tool. This is a full staged workflow: Discovery → PRD → Architecture → User Stories → Delivery.

🔗 https://github.com/SheldonChangL/ai-requirements-factory

**2/6** The AI agent doesn't just accept your input and generate. It interviews you first — asking structured follow-up questions until requirements are actually clear.

Then it generates a PRD, architecture draft (with Mermaid diagrams), and epic-grouped stories.

**3/6** Every stage supports:
- Manual editing
- AI-assisted refinement
- Review notes and revision history
- Diff review before applying changes

No silent overwrites. You stay in control.

**4/6** Self-hosted because product requirements are sensitive.

Works with:
- Ollama (local models)
- Claude CLI
- Gemini CLI
- Codex CLI
- Any OpenAI-compatible API

Prompt templates are just Markdown files you can customize.

**5/6** When you're done, preview delivery items and publish directly to Jira or GitHub. No copy-paste.

Stack: Next.js + FastAPI + LangGraph + SQLite
License: Apache-2.0

**6/6** Current state: public alpha. The workflow is end-to-end functional.

Next up: team collaboration, pluggable stage system, more delivery targets.

Feedback and contributions welcome 🙏

---

## Product Hunt tagline options

- "Turn product ideas into Jira-ready stories — self-hosted, AI-powered"
- "Self-hosted AI pipeline: from rough idea to structured user stories"
- "Stop writing PRDs by hand — let AI interview you, then deliver to Jira"
