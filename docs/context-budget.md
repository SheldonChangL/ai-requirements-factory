# Context Budget Management

This repository uses model-aware prompt budgeting so workflow stages do not blindly send the full chat history and every artifact on every request.

## What it does

- assigns each model adapter a context budget
- reserves response tokens separately from prompt tokens
- compacts long chat histories while preserving recent turns
- compacts large markdown artifacts section-by-section instead of truncating raw text blindly
- biases retained sections toward the latest revision instruction or stage-chat request

## Where it lives

- Context helpers: `backend/context_budget.py`
- Model budgets: `backend/model_adapters.py`
- Prompt compaction: `backend/prompts.py`

## Current strategy

### Conversation history

- keep recent turns in raw form
- summarize older turns into compact bullet-style memory
- annotate condensed context blocks so the model can see when earlier turns were compressed

### Markdown artifacts

- split content by markdown headings
- preserve high-value sections such as overview, scope, requirements, architecture, security, and stories
- boost sections whose headings match the latest user instruction
- clip oversized selected sections only after section-level prioritization

## Why this matters

Without prompt budgeting, large PRDs, architecture drafts, and multi-turn discussions eventually produce:

- unstable behavior across different models
- higher latency and token cost
- accidental loss of the most relevant user instruction
- local-model failures on smaller context windows

## Current limitations

- token estimation is heuristic, not tokenizer-exact
- there is no semantic retrieval layer yet
- earlier turns are summarized heuristically rather than by a dedicated memory model

This is still a large improvement over the previous behavior, where prompts were built from full raw histories and full artifacts by default.
