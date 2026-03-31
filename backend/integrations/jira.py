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


def _jira_auth_headers(email: str, token: str) -> dict[str, str]:
    auth = base64.b64encode(f"{email}:{token}".encode()).decode()
    return {
        "Authorization": f"Basic {auth}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _derive_project_key(name: str) -> str:
    """Derive a Jira project key from a project name (2–10 uppercase letters)."""
    words = name.upper().split()
    # Take first letter of each word
    key = "".join(w[0] for w in words if w and w[0].isalpha())
    if len(key) < 2:
        # Fall back to first alpha chars of the full name
        key = "".join(c for c in name.upper() if c.isalpha())
    return key[:10] or "PROJ"


def get_jira_account_id(domain: str, email: str, token: str) -> str:
    req = urllib.request.Request(
        f"https://{domain}/rest/api/3/myself",
        headers=_jira_auth_headers(email, token),
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())["accountId"]


def create_jira_project(
    domain: str, email: str, token: str, name: str, key: str | None = None
) -> dict[str, str]:
    """Create a new Jira software project. Returns {key, name, id}."""
    project_key = (key or _derive_project_key(name)).upper().strip()
    lead_account_id = get_jira_account_id(domain, email, token)
    payload = {
        "key": project_key,
        "name": name.strip(),
        "projectTypeKey": "software",
        "leadAccountId": lead_account_id,
    }
    req = urllib.request.Request(
        f"https://{domain}/rest/api/3/project",
        data=json.dumps(payload).encode(),
        headers=_jira_auth_headers(email, token),
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        body = json.loads(resp.read())
        return {"key": body["key"], "name": name.strip(), "id": str(body["id"])}


def list_jira_projects(domain: str, email: str, token: str) -> list[dict[str, str]]:
    req = urllib.request.Request(
        f"https://{domain}/rest/api/3/project",
        headers=_jira_auth_headers(email, token),
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
