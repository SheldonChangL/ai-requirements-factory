Parse the following User Stories Markdown into a JSON array. Each item must have:
- "summary": short title (max 80 chars) suitable for a Jira issue title
- "description": full story text including acceptance criteria in plain text
- "story_points": integer (the estimated story points)
- "epic": the Epic/Feature group name

Return ONLY a valid JSON array with no markdown wrapper, no explanation, no code fences.

User Stories:
{{USER_STORIES_DRAFT}}
