# Roadmap

## Current milestone

The project has completed its public alpha workflow foundation.

That milestone includes:

- self-hosted staged workflow from requirements to delivery
- file-based prompt profiles and model adapter contracts
- Jira and GitHub delivery publishing with preview-before-publish
- review-first stage edits and AI revisions
- stage status, review notes, revision logs, and dependency-aware summaries
- baseline open-source packaging and CI/community scaffolding

See [docs/project/milestones.md](/Users/sheldon.chang/Tools/ai-dev-ver2/docs/project/milestones.md) for the formal checkpoint.

## Next phase: Team workflow and extensibility

### 1. Collaboration baseline

- Add actor identity to approvals, comments, revisions, and publish actions.
- Add stage version checks to prevent stale-tab overwrites.
- Add background refresh or lightweight real-time sync for shared projects.
- Add richer review flows such as threaded comments and reviewer assignment.

### 2. Workflow extensibility

- Replace hard-coded stage assumptions with a stage registry / stage config model.
- Formalize stage capabilities so new stages can plug into generation, review, and delivery flows.
- Add reusable workflow templates beyond the current PRD -> Architecture -> User Stories chain.

### 3. Delivery growth

- Add additional delivery targets such as Linear.
- Add export-to-file targets for non-tracker workflows.
- Keep target-specific publish logic separate from neutral delivery item generation.

### 4. Reliability

- Add better automated coverage for stage APIs and governance flows.
- Improve diagnostics for model availability, integration readiness, and publish failures.
- Improve handling and messaging for stale downstream artifacts and edit conflicts.

## Hosted / Commercial Direction

The open source project will keep the workflow engine and core integrations open.

Potential hosted-only features:

- SSO and organization management
- Role-based access control
- Approval workflows
- Audit logs
- Usage analytics
- Managed hosting and support
