# Model Adapter Contract

Model adapters live in [backend/model_adapters.py](/Users/sheldon.chang/Tools/ai-dev-ver2/backend/model_adapters.py).

## Contract

Each adapter must provide:

- A unique `model_choice` string
- An `invoke(prompt: str) -> str` implementation that returns plain text only
- An `is_available() -> bool` health check suitable for `/api/models/check`
- Provider-specific failures surfaced as `RuntimeError`

## Registration flow

1. Add a new `ModelAdapter` entry to `MODEL_ADAPTERS`.
2. Implement invocation logic for the provider.
3. Implement a lightweight availability check.
4. Ensure the provider returns plain text that can be consumed by the existing workflow stages.

## Current adapters

- `ollama`
- `gemini-cli`
- `claude-cli`
- `codex-cli`
- `openai-compatible`

## OpenAI-compatible configuration

Set these backend environment variables:

- `OPENAI_COMPAT_BASE_URL`
- `OPENAI_COMPAT_API_KEY`
- `OPENAI_COMPAT_MODEL`

The adapter uses:

- `GET /models` for lightweight availability checks
- `POST /chat/completions` for prompt execution

## Design notes

- The workflow calls `invoke_model(model_choice, prompt)` and does not know provider internals.
- `/api/models/check` reads adapter health checks from the same registry.
- Adding a provider should not require editing prompt builders or workflow stage logic.
