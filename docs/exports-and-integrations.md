# Export and Integration Contract

## Export endpoint

Endpoint: `GET /api/export/{thread_id}`

Supported formats:

- `format=markdown` (default)
- `format=json`

## Delivery Excel export

Endpoint: `GET /api/delivery/export/excel/{thread_id}?model_choice=<model>`

Behaviour:

- requires an existing user stories draft
- parses delivery items from the latest stories content
- keeps tracker-compatible `estimate` values for Jira / GitHub flows
- adds workbook-first planning fields such as senior-RD effort and Requirement IDs
- returns a downloadable `.xlsx` workbook

Workbook sheets:

- `Overview`
- `Prioritised Tasks`
- `Gantt Schedule`
- `Scoring & Guidance`

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
    "senior_rd_days": 1.5,
    "requirement_refs": ["FR-1", "NFR-2"],
    "epic": "Epic or feature group"
  }
]
```

## Delivery item planning shape

The internal delivery-item model now supports both tracker compatibility and workbook planning:

```json
[
  {
    "title": "Short issue title",
    "body": "Full story text including acceptance criteria",
    "estimate": 3,
    "senior_rd_days": 1.5,
    "group": "Epic or feature group",
    "requirement_refs": ["FR-1", "OPS-1"],
    "requirement_source": "explicit",
    "labels": ["story", "group:core workflow"]
  }
]
```

## Error categories

Relevant structured categories returned by the backend include:

- `model_error`
- `story_parse_error`
- `missing_user_stories`
- `jira_auth_error`
- `jira_api_error`
- `jira_network_error`
- `file_parse_error`
- `invalid_export_format`
- `export_empty`
- `export_error`
