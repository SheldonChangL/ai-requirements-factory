"""Jira delivery integration."""

from __future__ import annotations

import base64
import json
import urllib.error
import urllib.request

try:
    from artifacts import DeliveryItem
    from integrations.registry import DeliveryPublishResult
except ModuleNotFoundError:
    from backend.artifacts import DeliveryItem
    from backend.integrations.registry import DeliveryPublishResult


def list_jira_projects(domain: str, email: str, token: str) -> list[dict[str, str]]:
    auth = base64.b64encode(f"{email}:{token}".encode()).decode()
    url = f"https://{domain}/rest/api/3/project"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Basic {auth}",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        projects = json.loads(resp.read())
        return [
            {"key": p["key"], "name": p["name"], "id": str(p["id"])}
            for p in projects
        ]


def preview_jira(items: list[DeliveryItem], config: dict[str, str]) -> list[dict]:
    project_key = config.get("project_key", "YOUR_PROJECT")
    preview: list[dict] = []
    for item in items:
        preview.append(
            {
                "project": project_key,
                "summary": item.title[:80],
                "issue_type": "Story",
                "group": item.group,
                "estimate": item.estimate,
            }
        )
    return preview


def publish_jira(items: list[DeliveryItem], config: dict[str, str]) -> DeliveryPublishResult:
    auth = base64.b64encode(
        f"{config['email']}:{config['token']}".encode()
    ).decode()
    headers = {
        "Authorization": f"Basic {auth}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    jira_url = f"https://{config['domain']}/rest/api/3/issue"
    created: list[str] = []

    for item in items:
        description_text = (
            f"{item.body}\n\n"
            f"Group: {item.group}\n"
            f"Story Points: {item.estimate}\n"
            f"Labels: {', '.join(item.labels)}"
        )
        payload = {
            "fields": {
                "project": {"key": config["project_key"]},
                "summary": item.title[:80],
                "description": {
                    "type": "doc",
                    "version": 1,
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [{"type": "text", "text": description_text}],
                        }
                    ],
                },
                "issuetype": {"name": "Story"},
            }
        }

        req = urllib.request.Request(
            jira_url,
            data=json.dumps(payload).encode(),
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.loads(resp.read())
            created.append(body["key"])

    return DeliveryPublishResult(
        success=True,
        target="jira",
        count=len(created),
        created=created,
    )
