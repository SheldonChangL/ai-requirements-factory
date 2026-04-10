# Feature Spec Template

Use this template for feature work that is large enough to need deliberate scoping before implementation.

Recommended when the change:
- touches more than one layer such as `frontend`, `backend`, prompts, or integrations
- affects staged workflow behaviour or downstream invalidation rules
- will likely take more than 30 minutes or span more than a few commits

For small fixes, use an issue or a short note instead.

## Document Control

- Title:
- Status: draft | approved | implemented | superseded
- Owner:
- Last Updated:
- Related Issue / PR:
- Planned Implementation Doc: `docs/plans/<feature-name>.md`

## Problem

What is broken, missing, risky, or too manual today?

## Outcome

What concrete improvement should exist after this ships?

## Why Now

Why is this worth doing in the current milestone or roadmap phase?

## Users and Impact

Who benefits?
- maintainer / contributor
- self-hosted evaluator
- product / engineering team using the workflow

What changes for them?

## Current State

Describe the current behaviour and relevant repo context.

Consider whether the change touches:
- `frontend/app/page.tsx` workspace interactions
- `backend/main.py` APIs and stage actions
- `backend/workflow.py` or `backend/artifacts.py`
- `backend/prompt_profiles/default/` prompt behaviour
- `backend/integrations/` delivery targets
- `docs/project/` roadmap or milestone assumptions

## Goals

- Goal 1
- Goal 2

## User Stories / Usage Scenarios

Use this section for product-facing intent. These are not enough on their own to verify the work; they provide the user context that the plan and acceptance criteria must honour.

- `US-1`: As a ..., I want ..., so that ...
- `US-2`: As a ..., I want ..., so that ...

## Non-Goals

- Non-goal 1
- Non-goal 2

## Constraints

- Technical constraints:
- Product constraints:
- Backwards-compatibility constraints:
- Hosted-boundary or OSS-boundary constraints:

## Assumptions

- Assumption 1
- Assumption 2

## Open Questions

- Question 1
- Question 2

## Requirements

Write requirements as individually traceable items.

### Functional Requirements

- `FR-1`: ...
- `FR-2`: ...

### Non-Functional Requirements

- `NFR-1`: ...
- `NFR-2`: ...

### Operational / Safety Requirements

- `OPS-1`: ...
- `OPS-2`: ...

## Proposed Approach

### Workflow / Product Behaviour

Explain how the staged flow changes, if at all.

### Backend

List API, data model, workflow, or persistence changes.

### Frontend

List UI, navigation, review flow, or state-management changes.

### Prompts / Model Behaviour

List prompt profile or context-budget implications.

### Integrations / Export

List Jira, GitHub, or future delivery target implications.

## Risks

- Risk:
  Mitigation:
- Risk:
  Mitigation:

## Acceptance Criteria

Acceptance criteria should be observable outcomes. Each item should map back to one or more requirements or user stories.

- `AC-1`: A user can ...
  Refs: `US-1`, `FR-1`
- `AC-2`: A maintainer can ...
  Refs: `FR-2`, `OPS-1`
- `AC-3`: The system prevents ...
  Refs: `NFR-1`, `OPS-2`

## Verification

List the checks needed to call this complete. This is the evidence layer, not the story layer.

Suggested format:

| Acceptance ID | What to verify | Method |
| --- | --- | --- |
| `AC-1` | ... | manual exercise |
| `AC-2` | ... | API check / build / unit test |
| `AC-3` | ... | conflict simulation / regression check |

Typical repo commands:

```bash
python3 -m py_compile backend/main.py backend/artifacts.py backend/workflow.py backend/model_adapters.py backend/context_budget.py backend/integrations/jira.py backend/integrations/github.py backend/integrations/registry.py backend/integrations/registry_map.py
cd frontend && npm run build
```

Add feature-specific manual checks as needed:
- create a new project and exercise the affected stage flow
- verify review-before-apply still behaves correctly
- verify downstream invalidation messaging still makes sense

## Rollout Notes

- Is migration needed?
- Does any existing project data need backfill?
- Should docs in `README.md` or `docs/project/` be updated?

## Follow-ups

- Follow-up 1
- Follow-up 2
