"""GitHub Issues delivery integration."""

from __future__ import annotations

import json
import urllib.request

try:
    from artifacts import DeliveryItem
    from integrations.registry import DeliveryPublishResult
except ModuleNotFoundError:
    from backend.artifacts import DeliveryItem
    from backend.integrations.registry import DeliveryPublishResult


def _github_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
    }


def create_github_repo(
    token: str, name: str, private: bool = False, org: str | None = None
) -> dict[str, str]:
    """Create a new GitHub repo. Returns {full_name, owner, name}."""
    repo_name = name.strip().replace(" ", "-")
    payload = {"name": repo_name, "private": private, "auto_init": True}
    url = (
        f"https://api.github.com/orgs/{org}/repos" if org
        else "https://api.github.com/user/repos"
    )
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=_github_headers(token),
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        body = json.loads(resp.read())
        return {
            "full_name": body["full_name"],
            "owner": body["owner"]["login"],
            "name": body["name"],
        }


def list_github_repos(token: str) -> list[dict[str, str]]:
    url = "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member"
    req = urllib.request.Request(url, headers=_github_headers(token))
    with urllib.request.urlopen(req, timeout=10) as resp:
        repos = json.loads(resp.read())
        return [
            {"full_name": r["full_name"], "owner": r["owner"]["login"], "name": r["name"]}
            for r in repos
        ]


def preview_github(items: list[DeliveryItem], config: dict[str, str]) -> list[dict]:
    preview: list[dict] = []
    owner = config.get("owner", "your-org")
    repo_name = config.get("repo", "your-repo")
    repo = f"{owner}/{repo_name}"
    for item in items:
        preview.append(
            {
                "repository": repo,
                "title": item.title,
                "labels": item.labels,
                "group": item.group,
                "estimate": item.estimate,
            }
        )
    return preview


def publish_github(items: list[DeliveryItem], config: dict[str, str]) -> DeliveryPublishResult:
    url = f"https://api.github.com/repos/{config['owner']}/{config['repo']}/issues"
    headers = _github_headers(config["token"])
    created: list[str] = []

    for item in items:
        payload = {
            "title": item.title,
            "body": (
                f"{item.body}\n\n"
                f"Group: {item.group}\n"
                f"Story Points: {item.estimate}"
            ),
            "labels": item.labels,
        }
        request = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            body = json.loads(response.read())
            created.append(body["html_url"])

    return DeliveryPublishResult(
        success=True,
        target="github",
        count=len(created),
        created=created,
    )
