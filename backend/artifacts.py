"""Artifact helpers for workflow outputs."""

from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass
class DeliveryItem:
    title: str
    body: str
    estimate: int
    group: str
    labels: list[str]


@dataclass
class ProjectArtifacts:
    thread_id: str
    prd: str
    architecture: str
    user_stories: str


def build_project_artifacts(thread_id: str, values: dict) -> ProjectArtifacts:
    return ProjectArtifacts(
        thread_id=thread_id,
        prd=str(values.get("prd_draft", "")).strip(),
        architecture=str(values.get("architecture_draft", "")).strip(),
        user_stories=str(values.get("user_stories_draft", "")).strip(),
    )


def export_project_json(artifacts: ProjectArtifacts) -> dict[str, str]:
    return {
        "thread_id": artifacts.thread_id,
        "prd": artifacts.prd,
        "architecture": artifacts.architecture,
        "user_stories": artifacts.user_stories,
    }


def export_project_markdown(artifacts: ProjectArtifacts) -> str:
    sections: list[str] = [f"# Project: {artifacts.thread_id}\n"]

    if artifacts.prd:
        sections.append("## Product Requirements Document\n")
        sections.append(artifacts.prd)

    if artifacts.prd and artifacts.architecture:
        sections.append("\n---\n")

    if artifacts.architecture:
        sections.append("## System Architecture\n")
        sections.append(artifacts.architecture)

    if (artifacts.prd or artifacts.architecture) and artifacts.user_stories:
        sections.append("\n---\n")

    if artifacts.user_stories:
        sections.append("## User Stories\n")
        sections.append(artifacts.user_stories)

    return "\n".join(sections)


def delivery_items_to_json(items: list[DeliveryItem]) -> list[dict]:
    return [asdict(item) for item in items]
