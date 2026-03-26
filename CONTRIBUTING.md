# Contributing

## Development setup

1. Start the backend:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

2. Start the frontend in a second terminal:

```bash
cd frontend
npm install
npm run dev
```

3. Start Ollama or configure another supported model backend.

## Contribution guidelines

- Keep changes small and focused.
- Prefer adding extension points over adding more hardcoded branching.
- Do not commit secrets, local `.env` files, or generated runtime databases.
- Update docs when behavior or setup changes.

## Areas where contributions are especially welcome

- Model adapters
- Prompt and template extraction
- Export targets
- Additional document parsers
- Jira and tracker integrations
- Tests and sample scenarios

## Pull request checklist

- Describe the user-visible behavior change.
- Note any new environment variables or external dependencies.
- Include screenshots or sample output when UI behavior changes.
- Call out any backward compatibility impact.
