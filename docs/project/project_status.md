# Project Status

## Current State

- The workflow has been refactored from a fixed linear pipeline into a modular delivery workflow.
- Jira and GitHub delivery integrations are both implemented.
- The right-side workspace UI has been refactored from a single long preview into stage-based workspaces:
  - PRD
  - Architecture
  - User Stories
- Each stage now has its own direct editing and AI-assisted revision flow.
- Each stage now has its own status and activity model:
  - `draft`
  - `approved`
  - `needs_revision`
- Delivery publishing now supports a two-step flow:
  - configure target
  - preview payload before publish
- Integration settings are now managed from a dedicated Settings page instead of the main workspace modal.
- Workspace navigation now preserves the selected project when entering and leaving Settings.
- Project-tracking documents now live under `docs/project/` instead of the repo root.
- Direct edits now go through a diff review modal before applying changes.
- Dedicated PRD AI revisions now produce a reviewable diff before they overwrite downstream stages.
- Stage-chat AI updates for Architecture and User Stories now go through the same review-before-apply flow.
- Prompt building is now model-aware and context-budgeted instead of always injecting full histories and full artifacts.
- Each stage now supports structured review notes that can be resolved or reopened independently from artifact edits.
- Each stage now exposes a revision log with source, review state, instruction context, and downstream invalidation metadata.
- The workspace now includes a compact stage summary panel showing dependencies, downstream impact, open notes, and latest revision state.

## Latest Completed Work

- `7585084` `feat: modularize delivery workflow and integrations`
- `46d2b5b` `feat: add unified delivery publishing UI`
- `a821b1b` `docs: record completed workflow refactor checklist`
- `1316677` `feat: add stage-based workspace editing flows`
- `557ea7a` `feat: encrypt integration tokens and add Jira project selector`
- `5cd4102` `fix: Jira project selector must fetch from API, not allow manual entry`
- `973a2df` `refactor: remove project key from Jira Settings, fetch projects from API`
- `ca74b08` `fix: parse projects from response wrapper { projects: [...] }`
- `7612b19` `feat: GitHub repo selection via API, same flow as Jira projects`
- `b346df2` `feat: add delivery preview step before publish`
- `258c8a0` `feat: add stage approve/reopen controls with persistent status`
- `f98bd63` `feat: complete remaining todo items — activity history, label mapping, UX polish`

## Backend Status

- Added artifact helpers in `backend/artifacts.py`
- Added workflow helpers in `backend/workflow.py`
- Added integration registry and adapters in `backend/integrations/`
- Added stage-specific revision and save APIs in `backend/main.py`
- Added stage-specific prompt templates in `backend/prompt_profiles/default/`
- Added stage status APIs in `backend/main.py`
- Added stage activity event APIs in `backend/main.py`
- Added GitHub repository listing API in `backend/main.py`
- Added stage review notes tables and APIs in `backend/main.py`
- Added stage revision metadata tables and APIs in `backend/main.py`
- Added stage summary API in `backend/main.py`

## Frontend Status

- Replaced the right-side mixed preview with a stage-based workspace in `frontend/app/page.tsx`
- Users can now:
  - switch between PRD, Architecture, and User Stories
  - edit PRD directly
  - edit Architecture directly
  - edit User Stories directly
  - send stage-specific AI revision instructions
  - use stage-specific chat for Architecture and User Stories
  - approve, reopen, or mark stages as needing revision
  - inspect stage activity history
  - inspect stage revision logs
  - leave and resolve structured review notes per stage
  - see upstream/downstream dependencies and stage impact from a workspace summary panel
  - preview delivery payloads before publish
  - edit labels before publishing delivery items
  - publish User Stories to Jira or GitHub
- Added a dedicated Settings page in `frontend/app/settings/page.tsx`
- Integration storage helpers now live in `frontend/app/lib/integrations.ts`
- Jira and GitHub tokens are encrypted with AES-GCM in browser storage and reloaded within the same browser session

## Validation

- `python3 -m py_compile backend/main.py backend/prompts.py backend/artifacts.py backend/workflow.py backend/model_adapters.py backend/context_budget.py backend/integrations/jira.py backend/integrations/github.py backend/integrations/registry.py backend/integrations/registry_map.py`
- `npm run build`

## Current Assessment

- The project has moved from a prototype-style linear UI toward a usable staged workflow tool.
- The current implementation now covers staged editing, staged status control, structured review notes, revision metadata, activity history, delivery preview, encrypted integration credentials, and settings-based integration management.
- Direct edit governance is stronger now that reviewed content is applied explicitly instead of being saved immediately.
- Prompt construction is more stable across models because long histories and large artifacts are compacted before invocation.
- The next major improvement should focus on workflow extensibility and broader delivery/export targets.
