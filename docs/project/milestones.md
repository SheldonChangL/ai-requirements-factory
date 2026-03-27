# Milestones

## Milestone 1: Public Alpha Workflow Foundation

Status: completed on March 27, 2026

This milestone marks the point where the project moved from a prototype-style linear pipeline into a usable staged workflow tool for self-hosted evaluation.

### Scope completed

- Modularized the backend workflow around staged artifacts and delivery integrations.
- Added Jira and GitHub delivery publishing with preview-before-publish.
- Introduced file-based prompt profiles and documented model adapter contracts.
- Added model-aware context budget management for long histories and large artifacts.
- Reworked the workspace into stage-based PRD, Architecture, and User Stories editing flows.
- Added stage status, activity history, structured review notes, revision logs, and dependency-aware stage summaries.
- Moved integration configuration into Settings and persisted project metadata in the backend for shared project lists.
- Added baseline open-source repo hygiene:
  - `LICENSE`
  - `CONTRIBUTING.md`
  - `SECURITY.md`
  - `.github` issue / PR / CI scaffolding

### What this milestone means

- The product is now suitable for public alpha use, internal team trials, and contributor feedback.
- The workflow supports review-before-apply instead of silent overwrites.
- The UI now reflects stage ownership and downstream impact instead of treating the whole project as one long document.
- The codebase is in a reasonable state for extension work rather than one-off demo iteration.

### Known limits carried forward

- No user identity, attribution, or role model yet.
- No optimistic locking or concurrent edit protection.
- No real-time collaboration or background refresh layer.
- Stages are still hard-coded rather than fully pluggable.
- Delivery targets are limited to Jira and GitHub.
- Validation is build-oriented; automated product tests are still thin.

## Next Phase: Team Workflow and Extensibility

The next phase should focus on making the system safer for team usage and easier to extend.

### Track 1: Team collaboration baseline

- Add actor identity to comments, approvals, revisions, and delivery actions.
- Add stage version checks so stale browser tabs cannot silently overwrite newer work.
- Add background refresh or lightweight real-time sync so shared projects stay current across browsers.
- Add richer review flows:
  - reply threads on review notes
  - reviewer / assignee fields
  - who approved and when

### Track 2: Workflow extensibility

- Replace hard-coded stage assumptions with a stage registry / config model.
- Formalize stage capabilities:
  - generate
  - refine
  - review
  - export / deliver
- Prepare for additional workflow templates beyond the current PRD → Architecture → User Stories chain.

### Track 3: Delivery and export growth

- Add at least one more delivery target such as Linear.
- Add export-to-file targets for teams that want to review outside Jira / GitHub.
- Separate delivery item generation from target-specific publishing more cleanly.

### Track 4: Reliability and observability

- Add test coverage around stage APIs, review flows, and project persistence.
- Add clearer health / diagnostics views for model availability and integration readiness.
- Improve error reporting around stage conflicts, invalidated downstream work, and publish failures.
