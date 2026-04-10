# Implementation Plan Template

Use this after the feature spec is clear enough to execute.

This template is for turning a spec into small, verifiable slices that are safe to implement in a repo with:
- a `frontend` Next.js app
- a `backend` FastAPI and workflow layer
- file-based prompt profiles
- staged review and downstream invalidation behaviour

## Document Control

- Title:
- Status: planned | in_progress | blocked | done
- Owner:
- Last Updated:
- Spec: `docs/specs/<feature-name>.md`
- Related Issue / PR:

## Objective

State the implementation goal in one paragraph.

## Traceability

Before writing tasks, link the spec to executable work.

| Spec Item | Type | Covered By Slice | Covered By Task | Verified By |
| --- | --- | --- | --- | --- |
| `FR-1` | functional | Slice 1 | Task 1 | `AC-1` |
| `NFR-1` | non-functional | Slice 2 | Task 3 | `AC-3` |
| `OPS-1` | operational | Slice 3 | Task 5 | `AC-2` |

If a spec item cannot be mapped, the plan is not ready.

## Out of Scope

- Out-of-scope item 1
- Out-of-scope item 2

## Assumptions

- Assumption 1
- Assumption 2

## Affected Areas

- Frontend:
- Backend API:
- Workflow / persistence:
- Prompt profiles:
- Integrations / export:
- Docs:

## Execution Strategy

Describe the preferred order of work. Favour vertical slices over layer-by-layer churn.

Suggested order for this repo:
1. data model / workflow contract
2. API surface
3. frontend state and UI
4. prompt or integration updates
5. validation and docs

## Work Slices

### Slice 1

- Goal:
- Spec refs:
- Story refs:
- Acceptance refs:
- Files likely touched:
- Deliverable:
- Dependencies:
- Verification:

### Slice 2

- Goal:
- Spec refs:
- Story refs:
- Acceptance refs:
- Files likely touched:
- Deliverable:
- Dependencies:
- Verification:

### Slice 3

- Goal:
- Spec refs:
- Story refs:
- Acceptance refs:
- Files likely touched:
- Deliverable:
- Dependencies:
- Verification:

Add more slices only when each slice is still independently testable.

## Tasks

Break each slice into tasks that can be completed and checked without ambiguity.

| Task | Slice | Purpose | Spec / AC refs | Output | Verification |
| --- | --- | --- | --- | --- | --- |
| Task 1 | Slice 1 | ... | `FR-1`, `AC-1` | code / API / doc change | command or manual check |
| Task 2 | Slice 1 | ... | `OPS-1`, `AC-2` | code / API / doc change | command or manual check |
| Task 3 | Slice 2 | ... | `NFR-1`, `AC-3` | code / API / doc change | command or manual check |

## Verification Matrix

| Area | Check | Command / Method |
| --- | --- | --- |
| Backend syntax | Python modules compile | `python3 -m py_compile ...` |
| Frontend build | Next.js build passes | `cd frontend && npm run build` |
| Workflow behaviour | Stage transitions behave correctly | manual exercise |
| Review safety | Review-before-apply still works | manual exercise |
| Regression surface | Affected integration or export path still works | manual exercise |

Replace `...` with the exact Python file list for the change.

## Sequencing Notes

- Start with the smallest change that proves the contract.
- Keep patches localised; avoid broad rewrites unless the spec explicitly requires them.
- Re-read files before each edit in case another process changed them.
- If frontend and backend are both moving, land the contract first so validation is straightforward.

## Risks and Mitigations

- Risk:
  Mitigation:
- Risk:
  Mitigation:

## Done Criteria

- The acceptance criteria in the linked spec are met.
- Every implementation task maps to a spec item or acceptance criterion.
- Validation commands pass.
- Manual checks for the affected stage flow have been completed.
- Any required docs or milestone notes are updated.

## Deferred Work

- Deferred item 1
- Deferred item 2
