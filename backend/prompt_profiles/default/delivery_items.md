Parse the following User Stories Markdown into a JSON array of delivery items. Each item must have:
- "title": short issue title
- "body": full story text including acceptance criteria in plain text
- "estimate": integer tracker-compatible estimate if available; if only Senior RD days are available, derive the closest compatibility estimate
- "senior_rd_days": number of ideal engineering days for one senior RD
- "group": epic or feature group
- "requirement_refs": an array of Requirement IDs such as `FR-1`, `NFR-2`, `OPS-1`
- "labels": an array of simple lowercase labels appropriate for trackers

Return ONLY a valid JSON array with no markdown wrapper, no explanation, no code fences.

User Stories:
{{USER_STORIES_DRAFT}}
