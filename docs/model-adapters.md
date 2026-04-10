# Model Adapter Contract

Model adapters live in [backend/model_adapters.py](../backend/model_adapters.py).

## Contract

Each adapter must provide:

- A unique `model_choice` string
- An `invoke(prompt: str) -> str` implementation that returns plain text only
- An `is_available() -> bool` health check suitable for `/api/models/check`
- Provider-specific failures surfaced as `RuntimeError`
- Context metadata:
  - `max_context_tokens`
  - `prompt_budget_tokens`
  - `response_budget_tokens`

## Registration flow

1. Add a new `ModelAdapter` entry to `MODEL_ADAPTERS`.
2. Implement invocation logic for the provider.
3. Implement a lightweight availability check.
4. Define realistic context budget metadata for the provider.
5. Ensure the provider returns plain text that can be consumed by the existing workflow stages.

## Current adapters

- `ollama`
- `gemini-cli`
- `claude-cli`
- `codex-cli`

## Design notes

- The workflow calls `invoke_model(model_choice, prompt)` and does not know provider internals.
- `/api/models/check` reads adapter health checks from the same registry.
- Adding a provider should not require editing prompt builders or workflow stage logic.
- Prompt builders are model-aware. They use adapter context budgets to compact:
  - long conversation histories
  - large PRDs
  - architecture drafts
  - user stories
- Context compaction currently uses:
  - recent-turn preservation for chat history
  - section-aware markdown selection for large artifacts
  - instruction-aware prioritization when revising existing content
