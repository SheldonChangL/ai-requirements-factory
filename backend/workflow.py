"""Workflow helpers separated from FastAPI route handlers."""

from __future__ import annotations

import json
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

        normalized.append(
            DeliveryItem(
                title=title,
                body=body,
                estimate=estimate,
                group=group,
                labels=normalized_labels,
            )
        )
    return normalized


def parse_delivery_items(user_stories_draft: str, model_choice: str) -> list[DeliveryItem]:
    raw_json = invoke_model(model_choice, build_delivery_items_prompt(user_stories_draft))
    parsed = json.loads(strip_code_fences(raw_json))
    if not isinstance(parsed, list):
        raise ValueError("Expected a JSON array at the top level.")
    return normalize_delivery_items(parsed)


def project_artifacts_from_state(thread_id: str, values: dict) -> ProjectArtifacts:
    return build_project_artifacts(thread_id, values)


def delivery_preview_payload(items: list[DeliveryItem]) -> list[dict]:
    return [asdict(item) for item in items]
