# Approved Artifact Knowledge Write-back Plan

## Summary

The current workflow can generate and review PRD, Architecture, and User Stories, but approved artifacts are still mostly one-off outputs.

This plan proposes a `knowledge write-back` layer:

- approved artifacts become reusable knowledge
- future requirement analysis can retrieve prior decisions
- the system accumulates product understanding over time

This is intended to move the product from "AI document generation pipeline" toward "AI requirements workspace with persistent product memory".

## Why This Matters

Without write-back:

- every project starts with weak long-term memory
- users repeat product background and constraints
- the AI asks more generic questions than necessary
- approval only changes workflow state, not organizational knowledge

With write-back:

- approved artifacts become durable context
- follow-up requests can reference prior modules, roles, integrations, and NFRs
- gap analysis can ask delta-focused questions instead of starting from zero
- approval becomes a governance event and a knowledge curation event

## Product Goal

Turn approved stage outputs into structured, queryable knowledge that can be reused in later sessions and later projects.

The write-back layer should support:

- repeated work on the same product
- multiple related initiatives within one product domain
- better context reuse during Discover, PRD, and Architecture stages
- future collaboration features such as shared product memory

## Scope

### In Scope

- write back approved PRD, Architecture, and User Stories
- normalize artifact content into knowledge entries
- retrieve relevant knowledge during later prompts
- show basic visibility in UI for what was written back

### Out of Scope for v1

- full semantic search stack
- multi-tenant enterprise knowledge management
- external knowledge sync to Confluence / Notion
- complex ontology editing UI
- automatic full-codebase spec generation

## Core Principle

Do not write back full artifacts as raw blobs only.

Instead:

1. store the raw approved artifact snapshot
2. derive structured knowledge entries from it
3. inject only relevant entries back into later prompts

This avoids repeating the current problem of oversized prompts and low-signal context.

## Proposed Data Model

### 1. Artifact Snapshots

Purpose:

- preserve the exact approved source
- support auditability
- allow re-derivation if normalization logic changes

Suggested fields:

- `id`
- `project_id`
- `stage`
- `source_revision_id`
- `content`
- `approved_at`
- `approved_by`
- `version_tag`

### 2. Knowledge Entries

Purpose:

- store reusable units of meaning derived from approved artifacts
- support selective retrieval

Suggested fields:

- `id`
- `project_id`
- `artifact_snapshot_id`
- `entry_type`
- `title`
- `body`
- `tags_json`
- `stage_origin`
- `status`
- `created_at`
- `updated_at`

Suggested `entry_type` values:

- `product_goal`
- `user_role`
- `module`
- `workflow_rule`
- `integration`
- `nfr_security`
- `nfr_performance`
- `nfr_availability`
- `domain_term`
- `architecture_service`
- `architecture_interface`
- `architecture_data_model`
- `delivery_epic`
- `delivery_constraint`

### 3. Retrieval Index Metadata

Purpose:

- allow later ranking and filtering without needing full-text injection every time

Suggested fields:

- `entry_id`
- `keywords_json`
- `importance`
- `superseded_by`
- `is_active`

Vector storage can be added later, but v1 can start with structured filtering plus lightweight keyword matching.

## Write-back Timing

Write-back should happen when a stage becomes meaningfully approved, not on every draft save.

Recommended trigger:

- when user marks a stage as `approved`

Recommended behavior:

1. capture the approved revision snapshot
2. run normalization for that stage
3. mark prior conflicting entries as superseded when appropriate
4. make new entries available to later retrieval

This keeps write-back aligned with reviewed intent rather than noisy intermediate edits.

## Stage-specific Write-back Rules

### PRD

Best source for:

- product goals
- personas / user roles
- modules
- business rules
- integrations
- non-functional requirements
- compliance constraints

### Architecture

Best source for:

- services
- interfaces
- data flows
- persistence decisions
- architectural constraints
- operational decisions

### User Stories

Best source for:

- epic grouping
- delivery boundaries
- acceptance expectations
- implementation slices

User Stories should contribute less to durable product truth than PRD or Architecture.
They are useful, but often more tactical and more likely to expire.

## Retrieval Strategy

Knowledge should be reused selectively by stage.

### Discover Stage

Inject:

- product goals
- major modules
- existing user roles
- known integrations
- known NFR/compliance rules

Use case:

- avoid re-asking foundational questions
- focus on deltas and missing information

### PRD Stage

Inject:

- related product goals
- existing modules and rules
- relevant constraints
- similar prior feature summaries

Use case:

- keep PRD aligned with current product truth

### Architecture Stage

Inject:

- approved PRD-derived constraints
- prior services and interfaces
- prior integration patterns
- performance / security decisions

Use case:

- keep designs consistent with established architecture

### User Stories Stage

Inject:

- accepted architecture decisions
- delivery constraints
- known module boundaries

Use case:

- keep story breakdown grounded in actual design intent

## Prompt Injection Rules

The system should not dump all knowledge into every prompt.

Recommended rules:

- retrieve by stage relevance first
- filter by tags and active status
- cap knowledge blocks by budget
- prefer short normalized entries over raw source text
- include raw source excerpts only when necessary

This should integrate cleanly with the existing context budget work.

## UI / Product Surface

### v1 UI

Lightweight visibility only:

- project-level `Knowledge` summary in the sidebar or settings area
- count of active knowledge entries
- latest write-back event in activity history
- simple per-stage indicator such as `Approved and written back`

### Later UI

- inspect knowledge entries by category
- view superseded vs active entries
- manually pin or suppress entries
- compare what changed between knowledge snapshots

## Rollout Plan

### Phase 1: Snapshot and Normalize

- add approved artifact snapshot storage
- derive structured entries on approval
- no retrieval yet

Goal:

- prove the write-back model and data shape

### Phase 2: Retrieval in Discover and PRD

- inject relevant knowledge into SA / PRD prompts
- expose minimal UI visibility

Goal:

- improve future requirement conversations

### Phase 3: Retrieval in Architecture and Stories

- reuse architecture-relevant knowledge downstream
- add supersession logic for stale entries

Goal:

- improve consistency across stages

### Phase 4: Knowledge Governance

- manual review of entries
- pin / suppress / merge
- richer traceability

Goal:

- make product memory maintainable over time

## Risks

### 1. Knowledge Drift

If superseded entries remain active, the AI may reuse outdated truth.

Mitigation:

- explicit active/superseded states
- approval-linked versioning

### 2. Over-injection

If too many entries are injected, prompts become noisy again.

Mitigation:

- stage-aware retrieval
- hard context caps
- normalized summaries over raw source

### 3. False Authority

Approved artifacts may still contain mistakes.

Mitigation:

- maintain traceability back to source revision
- allow knowledge suppression or later correction

### 4. Tactical Story Noise

User Stories can create overly detailed or short-lived knowledge.

Mitigation:

- keep story-derived knowledge lower priority
- only retain durable delivery structures

## Why This Is Stronger Than Simple Chat Memory

Simple chat memory stores conversational residue.

This plan stores:

- approved intent
- structured product truth
- retrievable context tied to governance events

That is a much stronger long-term asset for this product.

## Next Discussion Topics

When this moves into implementation planning, the next decisions should be:

1. whether knowledge is project-scoped only or can be shared across related projects
2. the exact normalization schema for PRD, Architecture, and User Stories
3. whether retrieval starts with keywords only or includes embeddings in v1
4. where the first UI entry point for knowledge visibility should live
