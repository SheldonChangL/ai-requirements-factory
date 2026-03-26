# Export and Integration Contract

## Export endpoint

Endpoint: `GET /api/export/{thread_id}`

Supported formats:

- `format=markdown` (default)
- `format=json`

### JSON export shape

```json
{
  "thread_id": "demo-project",
  "prd": "# Product Requirements Document ...",
  "architecture": "## System Architecture ...",
  "user_stories": "## Epic 1 ..."
}
```

## Jira integration contract

The Jira push step converts generated user stories into a JSON array with these fields before creating issues:

```json
[
  {
    "summary": "Short Jira issue title",
    "description": "Full story text including acceptance criteria",
    "story_points": 3,
    "epic": "Epic or feature group"
  }
]
```

## Error categories

Relevant structured categories returned by the backend include:

- `model_error`
- `story_parse_error`
- `jira_auth_error`
- `jira_api_error`
- `jira_network_error`
- `file_parse_error`
- `invalid_export_format`
- `export_empty`
