"""Workflow helpers separated from FastAPI route handlers."""

from __future__ import annotations

import json
import re
from dataclasses import asdict

try:
    from artifacts import DeliveryItem, ProjectArtifacts, build_project_artifacts
    from model_adapters import invoke_model
    from prompts import build_delivery_items_prompt
except ModuleNotFoundError:
    from backend.artifacts import DeliveryItem, ProjectArtifacts, build_project_artifacts
    from backend.model_adapters import invoke_model
    from backend.prompts import build_delivery_items_prompt


def strip_code_fences(raw_text: str) -> str:
    text = raw_text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(
            line for line in lines if not line.strip().startswith("```")
        ).strip()
    return text


def normalize_delivery_items(raw_items: list[dict]) -> list[DeliveryItem]:
    normalized: list[DeliveryItem] = []
    for raw in raw_items:
        title = str(raw.get("title", "Untitled item")).strip()[:120] or "Untitled item"
        body = str(raw.get("body", title)).strip() or title
        group = str(raw.get("group", "General")).strip() or "General"

        estimate = raw.get("estimate", 3)
        if not isinstance(estimate, int):
            try:
                estimate = int(estimate)
            except (TypeError, ValueError):
                estimate = 3

        labels = raw.get("labels", [])
        if not isinstance(labels, list):
            labels = []
        normalized_labels = [str(label).strip() for label in labels if str(label).strip()]
        if "story" not in normalized_labels:
            normalized_labels.insert(0, "story")

        target_project = str(raw.get("target_project", "")).strip()

        normalized.append(
            DeliveryItem(
                title=title,
                body=body,
                estimate=estimate,
                group=group,
                labels=normalized_labels,
                target_project=target_project,
            )
        )
    return normalized


def _compact_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _split_markdown_sections(markdown: str, heading_prefix: str) -> list[tuple[str, str]]:
    pattern = re.compile(
        rf"(?m)^(?P<title>{re.escape(heading_prefix)}\s+.+?)\s*$"
    )
    matches = list(pattern.finditer(markdown))
    sections: list[tuple[str, str]] = []
    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(markdown)
        sections.append((match.group("title").strip(), markdown[start:end].strip()))
    return sections


def _strip_story_heading(title_line: str) -> str:
    title = re.sub(r"^#+\s*", "", title_line).strip()
    title = re.sub(r"^Story\s*\d+(?:\.\d+)*\s*[：:]\s*", "", title, flags=re.IGNORECASE)
    title = re.sub(r"^Epic\s*\d+\s*[：:]\s*", "", title, flags=re.IGNORECASE)
    return title.strip()


def _extract_story_points(body: str) -> int:
    match = re.search(r"Story Points\*?\*?\s*[：:]\s*(\d+)", body, flags=re.IGNORECASE)
    if not match:
        return 3
    try:
        return int(match.group(1))
    except ValueError:
        return 3


def _build_story_body(body: str) -> str:
    cleaned = body.strip()
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned


def heuristic_delivery_items_from_markdown(user_stories_draft: str) -> list[DeliveryItem]:
    items: list[DeliveryItem] = []
    epic_sections = _split_markdown_sections(user_stories_draft, "##")
    for epic_heading, epic_body in epic_sections:
        if not re.match(r"^##\s+Epic\b", epic_heading, flags=re.IGNORECASE):
            continue

        group = _strip_story_heading(epic_heading) or "General"
        story_sections = _split_markdown_sections(epic_body, "###")
        for story_heading, story_body in story_sections:
            if not re.match(r"^###\s+Story\b", story_heading, flags=re.IGNORECASE):
                continue

            title = _compact_whitespace(_strip_story_heading(story_heading)) or "Untitled item"
            estimate = _extract_story_points(story_body)
            labels = ["story", f"group:{_compact_whitespace(group)[:40]}"]
            body = _build_story_body(story_body) or title

            items.append(
                DeliveryItem(
                    title=title[:120],
                    body=body,
                    estimate=estimate,
                    group=group,
                    labels=labels,
                )
            )
    return items


def parse_delivery_items(user_stories_draft: str, model_choice: str) -> list[DeliveryItem]:
    heuristic_items = heuristic_delivery_items_from_markdown(user_stories_draft)
    if heuristic_items:
        return heuristic_items

    try:
        raw_json = invoke_model(
            model_choice,
            build_delivery_items_prompt(
                model_choice=model_choice,
                user_stories_draft=user_stories_draft,
            ),
        )
        parsed = json.loads(strip_code_fences(raw_json))
        if not isinstance(parsed, list):
            raise ValueError("Expected a JSON array at the top level.")
        return normalize_delivery_items(parsed)
    except (RuntimeError, ValueError, json.JSONDecodeError):
        fallback_items = heuristic_delivery_items_from_markdown(user_stories_draft)
        if fallback_items:
            return fallback_items
        raise


def project_artifacts_from_state(thread_id: str, values: dict) -> ProjectArtifacts:
    return build_project_artifacts(thread_id, values)


def delivery_preview_payload(items: list[DeliveryItem]) -> list[dict]:
    return [asdict(item) for item in items]
