# Workflow Refactor Checklist

This checklist tracks the refactor from a fixed linear pipeline into a more modular workflow with pluggable delivery integrations.

## Planning and structure

- [x] Create a dedicated refactor checklist.
- [x] Introduce artifact helpers for PRD, architecture, user stories, and delivery payloads.
- [x] Introduce workflow helpers so stage logic is separated from FastAPI endpoints.
- [x] Introduce an integration registry for delivery targets.

## Delivery integrations

- [x] Refactor Jira into the integration layer.
- [x] Add GitHub Issues as a second delivery integration.
- [x] Add a tracker-neutral delivery item format that both Jira and GitHub can consume.

## API and backend

- [x] Add shared delivery endpoints and keep existing Jira endpoint behavior compatible.
- [x] Add GitHub configuration models and backend validation.
- [x] Add structured responses for delivery preview and publish actions.

## Frontend

- [x] Replace Jira-only publish flow with a delivery-target flow.
- [x] Add GitHub configuration UI and publish flow.
- [x] Show publish results for both Jira and GitHub.

## Validation

- [x] Run backend syntax validation.
- [x] Run frontend production build.
- [x] Smoke test artifact generation.
- [x] Smoke test Jira and GitHub payload generation paths.
