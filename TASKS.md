# Open Source Launch Tasks

This file tracks the work needed to turn this repo into a publishable, adoptable open source project for engineering teams.

## Release Blocking

- [x] Define open source positioning and launch scope.
- [x] Write an implementation plan for the launch.
- [x] Record the plan as repo tasks.
- [x] Rewrite the README around the self-hosted requirements pipeline story.
- [x] Add standard public-repo docs: license, contributing, security, code of conduct, roadmap.
- [x] Remove personal defaults and hardcoded instance details from product settings.
- [x] Add environment configuration examples for backend and frontend.
- [ ] Verify the happy path still works after configuration changes.

## Product Hardening

- [ ] Extract prompts and templates from the main backend module.
- [ ] Define a documented model adapter contract for new providers.
- [ ] Define a documented export and integration contract.
- [ ] Add an OpenAI-compatible adapter to reduce adoption friction.
- [ ] Improve error categories for model, parsing, and Jira failures.
- [ ] Add sample input files and one demo project scenario.

## OSS Readiness

- [x] Document supported use cases and explicit non-goals.
- [x] Document local development, release process, and contribution workflow.
- [ ] Add architecture diagrams and screenshots to project docs.
- [x] Publish a roadmap with open source and future hosted boundaries.

## Future Commercial Boundary

- [ ] Keep team governance features out of the open source MVP.
- [ ] Reserve hosted-only features for SSO, RBAC, approvals, audit logs, and analytics.
- [ ] Define what remains open in the workflow engine versus what becomes hosted/team-only.
