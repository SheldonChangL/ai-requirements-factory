# Todo Tasks

## Next UX / Workflow Priorities

- [x] Add stage-specific discussion threads so PRD, Architecture, and User Stories each have their own discussion context.
- [x] Add explicit "approve / reopen" controls per stage instead of relying only on generation state.
- [x] Add stage activity history so users can see what changed, when, and by which action.
- [x] Add side-by-side diff view for direct edits and dedicated PRD AI revisions before saving.
- [x] Extend diff review to stage-chat AI revisions before applying updated Architecture or User Stories content.
- [x] Add stage-level comments or review notes so users can leave structured feedback without editing content immediately.

## Workspace Improvements

- [x] Improve stage navigation so users can see upstream/downstream dependencies more clearly.
- [x] Add a compact stage summary panel with completion state, last update time, and downstream impact.
- [x] Reduce visual density in the workspace action panels and make primary actions more obvious.
- [x] Separate "AI revise" actions from "manual edit" actions more clearly in the UI.

## Backend / Data Model

- [x] Add model-aware context budget management so prompts compact long histories and large artifacts before invocation.
- [x] Introduce richer stage revision metadata for PRD, Architecture, and User Stories.
- [x] Add explicit stage status fields such as `draft`, `approved`, `needs_revision`.
- [ ] Prepare the workflow model for future pluggable stages beyond the current three.

## Delivery Integrations

- [x] Add delivery preview UI before publish for Jira and GitHub.
- [x] Move Jira/GitHub config to Settings page with gallery UI.
- [x] Encrypt tokens (AES-GCM) and persist across page reloads.
- [x] Auto-fetch Jira projects / GitHub repos from API — no manual key entry.
- [x] Add GitHub issue label mapping controls.
- [ ] Add support for additional delivery targets such as Linear or export-to-file.

## Documentation / Housekeeping

- [x] Commit and maintain `docs/project/project_status.md` after milestone-sized feature batches.
- [x] Commit and maintain `docs/project/todo_tasks.md` so it stays aligned with actual HEAD.
- [x] Ignore or clean generated frontend build artifacts such as `frontend/tsconfig.tsbuildinfo`.
