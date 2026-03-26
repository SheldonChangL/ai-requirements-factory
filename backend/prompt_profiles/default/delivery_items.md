Parse the following User Stories Markdown into a JSON array of delivery items. Each item must have:
- "title": short issue title
- "body": full story text including acceptance criteria in plain text
- "estimate": integer story estimate
- "group": epic or feature group
- "labels": an array of simple lowercase labels appropriate for trackers

Return ONLY a valid JSON array with no markdown wrapper, no explanation, no code fences.

User Stories:
{{USER_STORIES_DRAFT}}
