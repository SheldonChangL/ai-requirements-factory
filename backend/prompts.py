"""Prompt builders for the AI requirements workflow."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

PROMPT_PROFILE = os.getenv("PROMPT_PROFILE", "default").strip() or "default"
PROMPT_PROFILE_DIR = os.getenv("PROMPT_PROFILE_DIR", "").strip()
DEFAULT_PROMPT_PROFILE_DIR = Path(__file__).resolve().parent / "prompt_profiles" / PROMPT_PROFILE


def _active_prompt_dir() -> Path:
    if PROMPT_PROFILE_DIR:
        return Path(PROMPT_PROFILE_DIR).expanduser().resolve()
    return DEFAULT_PROMPT_PROFILE_DIR


@lru_cache(maxsize=None)
def _load_prompt_template(filename: str) -> str:
    prompt_dir = _active_prompt_dir()
    path = prompt_dir / filename
    if not path.exists():
        raise FileNotFoundError(
            f"Prompt template '{filename}' was not found in '{prompt_dir}'. "
            "Set PROMPT_PROFILE to a valid profile name or PROMPT_PROFILE_DIR to a valid directory."
        )
    return path.read_text(encoding="utf-8").strip()


def _render_template(template: str, replacements: dict[str, str]) -> str:
    rendered = template
    for key, value in replacements.items():
        rendered = rendered.replace(f"{{{{{key}}}}}", value)
    return rendered


def build_sa_prompt(conversation_text: str, existing_prd: str, already_ready: bool) -> str:
    sa_system = _load_prompt_template("sa_system.md")
    if already_ready and existing_prd.strip():
        amended_prefix = _render_template(
            _load_prompt_template("sa_amendment_prefix.md"),
            {"CURRENT_PRD": existing_prd},
        )
        system_prompt = f"{amended_prefix}\n\n{sa_system}"
    else:
        system_prompt = sa_system

    return _render_template(
        _load_prompt_template("sa_chat.md"),
        {
            "SYSTEM_PROMPT": system_prompt,
            "CONVERSATION_TEXT": conversation_text,
        },
    )


def build_architect_prompt(prd_draft: str) -> str:
    return _render_template(
        _load_prompt_template("architect.md"),
        {"PRD_DRAFT": prd_draft},
    )


def build_user_stories_prompt(prd_draft: str, architecture_draft: str) -> str:
    return _render_template(
        _load_prompt_template("user_stories.md"),
        {
            "PRD_DRAFT": prd_draft,
            "ARCHITECTURE_DRAFT": architecture_draft,
        },
    )


def build_prd_refine_prompt(prd_draft: str, instruction: str) -> str:
    return _render_template(
        _load_prompt_template("prd_refine.md"),
        {
            "PRD_DRAFT": prd_draft,
            "INSTRUCTION": instruction,
        },
    )


def build_architecture_refine_prompt(
    prd_draft: str,
    architecture_draft: str,
    instruction: str,
) -> str:
    return _render_template(
        _load_prompt_template("architecture_refine.md"),
        {
            "PRD_DRAFT": prd_draft,
            "ARCHITECTURE_DRAFT": architecture_draft,
            "INSTRUCTION": instruction,
        },
    )


def build_user_stories_refine_prompt(
    prd_draft: str,
    architecture_draft: str,
    user_stories_draft: str,
    instruction: str,
) -> str:
    return _render_template(
        _load_prompt_template("user_stories_refine.md"),
        {
            "PRD_DRAFT": prd_draft,
            "ARCHITECTURE_DRAFT": architecture_draft,
            "USER_STORIES_DRAFT": user_stories_draft,
            "INSTRUCTION": instruction,
        },
    )


def build_delivery_items_prompt(user_stories_draft: str) -> str:
    return _render_template(
        _load_prompt_template("delivery_items.md"),
        {"USER_STORIES_DRAFT": user_stories_draft},
    )
