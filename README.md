# AI Requirements Factory

A self-hosted AI requirements pipeline for engineering teams.

This project turns rough product ideas and source documents into a structured delivery flow:

1. Requirement discovery through a system-analyst interview
2. PRD generation with explicit non-functional requirements
3. Architecture draft generation with Mermaid diagrams
4. User story generation grouped by epic
5. Optional Jira issue creation

It is designed for teams that want local control, model flexibility, and a workflow they can customize instead of a closed SaaS product.

![App Home](docs/images/app-home.png)

## Why this exists

Most AI product-writing tools stop at "generate a PRD". This project is narrower and more operational:

- Self-hosted by default
- Works with local Ollama or CLI-based model backends
- Enforces requirement clarification before final PRD output
- Carries output forward into architecture and delivery artifacts
- Accepts source files such as PDF, DOCX, XLSX, and Markdown

## Who this is for

- Engineering managers
- Internal tooling teams
- Solution architects
- Product and engineering teams that already use Jira

## Non-goals

- A full multi-user product management suite
- A hosted collaboration platform
- A generic agent framework

## Workflow

### Stage 1: Discover

The SA agent interviews the user and asks follow-up questions until requirements are clear. If multiple details are missing, it emits a structured questionnaire instead of an unformatted prompt dump.

### Stage 2: Specify

Once requirements are complete, the backend generates a PRD and marks it ready for the next stage.

### Stage 3: Design

The architecture step produces a technical design draft and Mermaid diagrams. The draft can be manually edited before moving on.

### Stage 4: Deliver

The user stories step generates epic-grouped stories with acceptance criteria and story points. These can then be pushed into Jira.

## Architecture overview

```text
Browser (Next.js)
  -> FastAPI backend
     -> LangGraph state + SQLite checkpoints
     -> Model adapters (Ollama / Gemini CLI / Claude CLI / Codex CLI)
     -> File ingestion (PDF / DOCX / XLSX / Markdown)
     -> Jira REST API
```

## Repository layout

```text
.
├── backend/
│   ├── main.py
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── app/
│   ├── package.json
│   └── .env.example
├── TASKS.md
├── ROADMAP.md
└── README.md
```

## Quick start

### Prerequisites

- Python 3.11+
- Node.js 18+
- Ollama if you want to run a local model

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export $(grep -v '^#' .env.example | xargs)
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Configuration

### Backend environment variables

See `backend/.env.example`.

- `OLLAMA_HOST`: Ollama base URL
- `OLLAMA_MODEL`: default Ollama model name
- `CORS_ALLOW_ORIGINS`: comma-separated list of allowed origins
- `PROMPT_PROFILE`: prompt profile name under `backend/prompt_profiles/`
- `PROMPT_PROFILE_DIR`: optional absolute path to a custom prompt directory

### Frontend environment variables

See `frontend/.env.example`.

- `NEXT_PUBLIC_API_BASE`: backend base URL
- `NEXT_PUBLIC_DEFAULT_JIRA_DOMAIN`: optional default Jira domain for your team

## Supported inputs

- `.pdf`
- `.docx`
- `.xlsx`
- `.xls`
- `.md`

## Supported model backends

- Ollama
- Gemini CLI
- Claude CLI
- Codex CLI
- OpenAI-compatible APIs

## Extending model backends

Model providers are registered through [backend/model_adapters.py](backend/model_adapters.py).  
The adapter contract is documented in [docs/model-adapters.md](docs/model-adapters.md).

## Customizing prompts

Prompt templates are file-based and live under `backend/prompt_profiles/`.

The default profile is:

```text
backend/prompt_profiles/default/
├── sa_system.md
├── sa_amendment_prefix.md
├── sa_chat.md
├── architect.md
├── user_stories.md
└── story_parse.md
```

To customize prompts:

1. Copy `backend/prompt_profiles/default` to a new folder such as `backend/prompt_profiles/enterprise`.
2. Edit the Markdown files in that profile.
3. Set `PROMPT_PROFILE=enterprise` before starting the backend.

If you want prompts outside the repo, set `PROMPT_PROFILE_DIR` to a directory containing the same files.

## Public API

Core endpoints:

- `POST /api/chat`
- `GET /api/chat/{thread_id}`
- `DELETE /api/chat/{thread_id}`
- `POST /api/generate_architecture`
- `PUT /api/architecture/{thread_id}`
- `POST /api/generate_user_stories`
- `POST /api/push_to_jira`
- `POST /api/upload`
- `GET /api/export/{thread_id}`
- `GET /api/models/check`

`/api/export/{thread_id}` supports `format=markdown` and `format=json`.  
The export and integration contract is documented in [docs/exports-and-integrations.md](docs/exports-and-integrations.md).

## Contributing

See `CONTRIBUTING.md`.

## Security

See `SECURITY.md`.

## Roadmap

See `ROADMAP.md`.

## Additional docs

- [Architecture Guide](docs/architecture.md)
- [Export and Integration Contract](docs/exports-and-integrations.md)
- [Model Adapter Contract](docs/model-adapters.md)
- [Hosted Boundary](docs/hosted-boundary.md)
- [Examples](examples/README.md)

## License

This project is licensed under Apache-2.0. See `LICENSE`.
