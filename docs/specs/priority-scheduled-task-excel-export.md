# Priority-Scheduled Task Excel Export

## Document Control

- Title: Priority-Scheduled Task Excel Export
- Status: draft
- Owner: Sheldon / maintainer
- Last Updated: 2026-04-08
- Related Issue / PR:
- Planned Implementation Doc: `docs/plans/priority-scheduled-task-excel-export.md`

## Problem

The current delivery flow can preview and publish user-story-derived items to Jira or GitHub, and the generic project export endpoint only supports Markdown and JSON. There is no file-based delivery output for teams that plan work in spreadsheets, and the live workbook generator is still too basic for stakeholder review.

The current planning model also leans on Story Points, which is weak for this use case. For this workflow, maintainers need a more concrete answer: how long would one senior RD need to implement the feature set, and what should be done first?

## Outcome

Users can export delivery-ready tasks into a professional `.xlsx` workbook that:
- ranks tasks by explicit priority logic
- estimates how long one senior RD would need to implement each task
- links each task back to the original Requirement ID(s)
- provides a Gantt-style schedule view for sequencing
- looks presentation-ready without manual spreadsheet clean-up

## Why Now

This repo already identifies export-to-file as a next delivery target. A high-quality Excel output is a pragmatic bridge for teams that are not ready to publish directly to Jira or GitHub, or that need an internal review artefact first.

This is also the right time to replace abstract Story Points with an implementation-duration view, because the workbook is explicitly positioned as a planning artefact rather than a tracker payload.

## Users and Impact

Who benefits?
- engineering managers who need a prioritised implementation plan
- product managers who need a stakeholder-friendly deliverable
- SWQA reviewers who need traceable, testable planning evidence
- contributors who need a task list with clear scheduling rationale

What changes for them?
- they can download a reviewable workbook instead of reformatting Markdown by hand
- they can see senior-RD effort estimates in ideal engineering days instead of Story Points
- they can trace workbook rows back to requirement identifiers directly
- they can review a Gantt-style timeline before publishing into trackers

## Current State

Relevant repo context:
- `backend/main.py` now exposes `GET /api/delivery/export/excel/{thread_id}`
- `backend/exports_excel.py` generates a simple workbook, but its formatting and structure are still lightweight
- `output/spreadsheet/priority-task-plan-sample.xlsx` shows a stronger direction than the current runtime generator
- `frontend/app/settings/page.tsx` already shows an `Export to file` card
- delivery preview and publish flow already exists for Jira and GitHub
- user stories are parsed into tracker-neutral delivery items in the backend
- the current prompt and parsing flow still treat `Story Points` as the primary estimate signal

## Goals

- provide a polished `.xlsx` export path for delivery-ready tasks
- replace Story Points in the planning workbook with senior-RD implementation-duration estimates
- make the workbook visually strong enough for leadership, product, and SWQA review
- make each planning item traceable to original Requirement IDs
- add a Gantt-style sheet so sequencing is visible at a glance
- keep the output deterministic and understandable

## User Stories / Usage Scenarios

- `US-1`: As an engineering manager, I want a prioritised task workbook so that I can review sequencing before work starts.
- `US-2`: As a product manager, I want a polished Excel export so that I can share it with stakeholders who do not use Jira or GitHub.
- `US-3`: As a contributor, I want to see the priority rationale and expected implementation duration so that I understand why a task is scheduled where it is.
- `US-4`: As an SWQA reviewer, I want requirement traceability and a clear verification path so that I can validate the plan without reconstructing intent manually.

## Non-Goals

- bi-directional spreadsheet sync
- editing the workbook and re-importing changes into the app
- replacing Jira or GitHub integrations
- full resource planning with multi-person capacity modelling

## Constraints

- Technical constraints: workbook generation should be server-side and not require Excel on the host
- Product constraints: export should fit the current staged delivery model and not bypass review-first workflow rules
- Backwards-compatibility constraints: existing Markdown and JSON export must keep working unchanged
- Delivery constraints: senior-RD estimates should be represented as ideal engineering days, not calendar duration
- OSS-boundary constraints: output should stay file-based and self-hostable without vendor lock-in

## Assumptions

- delivery items remain the canonical tracker-neutral unit
- one senior full-stack RD is the baseline estimation persona for the workbook
- requirement IDs can be derived from PRD, refined user stories, or explicit story metadata
- Story Points may remain as transitional metadata for downstream tracker integrations, but they should not be the primary planning metric in the workbook

## Open Questions

- should the transition keep both Story Points and senior-RD duration internally for compatibility, or phase Story Points out completely later?
- if a story cannot be mapped to a Requirement ID, should the workbook block export or mark the row as `unmapped`?
- should the first Gantt-style view be date-based, sprint-bucket-based, or both?

## Requirements

### Functional Requirements

- `FR-1`: A user can export delivery-ready tasks as an `.xlsx` workbook from the delivery workflow.
- `FR-2`: The workbook includes a prioritised task sheet sorted by explicit priority logic.
- `FR-3`: The workbook includes an overview sheet with project name, export timestamp, totals, priority distribution, and total estimated senior-RD effort.
- `FR-4`: Each task row includes title, epic/group, senior-RD effort estimate in ideal engineering days, priority score or tier, scheduling bucket, labels, source story text or summary, and originating Requirement ID refs.
- `FR-5`: The workbook includes an explanation of the scoring logic, effort assumptions, and schedule rules.
- `FR-6`: The export is available only when user stories exist and delivery items can be parsed successfully.
- `FR-7`: The workbook includes a Gantt-style schedule sheet derived from senior-RD effort estimates and dependency ordering.
- `FR-8`: Each planning item is traceable back to one or more original Requirement IDs without leaving the workbook.

### Non-Functional Requirements

- `NFR-1`: The workbook opens cleanly in Microsoft Excel and Google Sheets without broken formulas or unreadable layout.
- `NFR-2`: The workbook has professional formatting: consistent typography, clear colour hierarchy, spacing, frozen headers, filters, readable column widths, and executive-ready visual structure.
- `NFR-3`: Export generation should complete quickly for normal project sizes and return a downloadable file in one request flow.
- `NFR-4`: The export should be deterministic for the same inputs and scoring rules.

### Operational / Safety Requirements

- `OPS-1`: If delivery item parsing fails, the export returns a structured error instead of a malformed workbook.
- `OPS-2`: The workbook must make the scoring logic, effort assumptions, and requirement mapping visible so users can challenge or audit the ordering and dates.
- `OPS-3`: The feature must not silently change existing Jira or GitHub publish behaviour.
- `OPS-4`: The feature ships with an SWQA-oriented verification checklist covering workbook rendering, traceability, and schedule integrity.

## Proposed Approach

### Workflow / Product Behaviour

Add `Export to file` as a real delivery target. The user can preview the backlog as usual, then choose an Excel export path that downloads a formatted workbook instead of publishing to an external tracker.

The workbook should use senior-RD duration as the primary planning signal and should expose requirement traceability and Gantt-style sequencing in the same artefact.

### Backend

- extend the Excel delivery export builder around the existing delivery item structure
- add or derive `senior_rd_days` and `requirement_refs` in the export row model
- define a priority-and-schedule routine that converts delivery items into ordered export rows
- return `.xlsx` as a downloadable response with a stable filename
- surface structured error categories for parse or export failures

### Frontend

- enable the existing `Export to file` delivery option
- present a clear CTA such as `Download Excel plan`
- show format-specific messaging so users know this is a planning file export rather than tracker publish

### Prompts / Model Behaviour

- update user-story generation/refinement guidance so planning output includes Requirement IDs and senior-RD duration estimates
- keep Story Points only as transitional compatibility metadata if downstream tracker integrations still depend on them
- keep prompt output deterministic enough that requirement refs and duration fields are parseable

### Integrations / Export

- position Excel as the first file-based delivery target
- keep room for later CSV or richer workbook variants without changing the base delivery item contract
- do not regress Jira or GitHub tracker delivery behaviour while the workbook adopts the new planning metric

## Risks

- Risk: workbook polish consumes time without improving planning quality
  Mitigation: lock the workbook information architecture and traceability first, then layer styling on top
- Risk: duration estimates create false precision
  Mitigation: label them as ideal senior-RD engineering days and document the assumptions explicitly
- Risk: requirement IDs are incomplete in source material
  Mitigation: make unmapped items visible and treat missing traceability as a review issue
- Risk: tracker integrations still depend on Story Points
  Mitigation: keep a transitional compatibility layer until Jira/GitHub mappings are intentionally changed

## Acceptance Criteria

- `AC-1`: A user with generated user stories can download an `.xlsx` workbook from the delivery flow.
  Refs: `US-1`, `US-2`, `FR-1`, `FR-6`
- `AC-2`: The workbook contains an overview sheet, a prioritised task sheet, a Gantt-style schedule sheet, and a scoring / guidance sheet with readable formatting.
  Refs: `US-1`, `US-2`, `FR-2`, `FR-3`, `FR-5`, `FR-7`, `NFR-2`
- `AC-3`: Tasks are ordered by visible priority logic, and each task shows senior-RD effort and Requirement ID refs used for planning.
  Refs: `US-1`, `US-3`, `US-4`, `FR-4`, `FR-5`, `FR-8`, `OPS-2`
- `AC-4`: Export failures return clear structured errors instead of corrupt or empty files.
  Refs: `FR-6`, `OPS-1`, `OPS-3`, `NFR-4`

## SWQA Verification Scope

Acceptance criteria should stay role-neutral and outcome-oriented. SWQA concerns are better expressed as verification ownership instead of rewriting every acceptance criterion around a reviewer persona.

| Check | Focus | Owner | Requirement refs |
| --- | --- | --- | --- |
| Workbook rendering | sheet names, widths, frozen headers, filters, formulas, and formatting render correctly in Excel and Sheets | `SWQA` | `FR-3`, `FR-7`, `NFR-1`, `NFR-2` |
| Traceability completeness | each task maps to Requirement IDs, and unmapped items are visible for review | `SWQA`, `PM` | `FR-4`, `FR-8`, `OPS-2` |
| Schedule integrity | Gantt ordering, dependency handling, and roll-up effort match the documented duration model | `SWQA`, `Engineering` | `FR-5`, `FR-7`, `OPS-2`, `OPS-4` |
| Regression safety | Jira/GitHub publish behaviour is unchanged and error payloads remain structured | `SWQA`, `Engineering` | `FR-6`, `OPS-1`, `OPS-3` |

## Verification

| Acceptance ID | What to verify | Owner | Method |
| --- | --- | --- | --- |
| `AC-1` | workbook download is available only when stories are ready | `Engineering` | manual UI exercise |
| `AC-2` | workbook sheets, headers, filters, widths, formulas, and formatting render cleanly | `SWQA` | open workbook in Excel or Sheets |
| `AC-3` | ordering, senior-RD estimates, and Requirement ID mapping match the documented logic | `SWQA`, `Engineering` | fixture-based backend check + workbook inspection |
| `AC-4` | parse or export failures surface structured error payloads and do not affect tracker publish paths | `Engineering`, `SWQA` | API check + regression exercise |

Typical repo commands:

```bash
python3 -m py_compile backend/main.py backend/artifacts.py backend/workflow.py backend/model_adapters.py backend/context_budget.py backend/integrations/jira.py backend/integrations/github.py backend/integrations/registry.py backend/integrations/registry_map.py backend/exports_excel.py
cd frontend && npm run build
```

Feature-specific checks:
- exercise delivery preview on a sample project
- export the workbook and inspect layout manually
- verify Jira and GitHub publish flow remain unchanged
- verify the Gantt sheet and Requirement ID traceability against a known sample

## Rollout Notes

- update `docs/exports-and-integrations.md`
- update Settings copy once `Export to file` is enabled
- consider a checked-in sample workbook under `output/spreadsheet/` that matches the live generator output
- document whether Story Points remain as transitional tracker metadata

## Follow-ups

- allow user-adjustable weighting for priority scoring
- add a capacity-aware team schedule view after the single-senior-RD baseline is stable
- remove legacy Story Points end-to-end once tracker integrations have been intentionally migrated
