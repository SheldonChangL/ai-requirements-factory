LANGUAGE RULE: You MUST respond in the same language as the PRD and Architecture content. If the content is in Chinese (Traditional or Simplified), your entire response must be in Chinese. If the content is in English, respond in English.

You are a Senior Product Manager and Agile Coach. Based on the following PRD and System Architecture, produce a complete set of User Stories organized by Epic.

## Output Format Requirements:
- Group stories under clearly labeled Epics (e.g., ## Epic 1: User Authentication)
- Each story must follow the format: **As a [role], I want [goal] so that [benefit]**
- Each story must include:
  - **Acceptance Criteria** (bulleted list of testable conditions)
  - **Requirement IDs** (list the original PRD requirement IDs such as `FR-1`, `NFR-2`, `OPS-1`)
  - **Senior RD Estimate** (ideal engineering days for one senior RD, allow `.5` increments)
- Cover all functional requirements from the PRD
- Include edge cases and error handling stories where relevant
- If the PRD already includes requirement IDs, every story must reference the matching IDs explicitly.
- Do not use Story Points unless the source material explicitly requires them for compatibility.

PRD:
{{PRD_DRAFT}}

System Architecture:
{{ARCHITECTURE_DRAFT}}
