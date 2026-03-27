"""Prompt builders for the AI requirements workflow."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

try:
    from context_budget import compact_conversation, compact_markdown, derive_context_budget
    from model_adapters import get_model_adapter
except ModuleNotFoundError:
    from backend.context_budget import compact_conversation, compact_markdown, derive_context_budget
    from backend.model_adapters import get_model_adapter

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


def _budget(model_choice: str):
    adapter = get_model_adapter(model_choice)
    return derive_context_budget(
        prompt_budget_tokens=adapter.prompt_budget_tokens,
        response_budget_tokens=adapter.response_budget_tokens,
    )


def build_sa_prompt(
    *,
    model_choice: str,
    conversation_text: str,
    existing_prd: str,
    already_ready: bool,
) -> str:
    budget = _budget(model_choice)
    sa_system = _load_prompt_template("sa_system.md")
    if already_ready and existing_prd.strip():
        current_prd = compact_markdown(
            existing_prd,
            token_budget=max(int(budget.prompt_tokens * 0.42), 800),
            label="current PRD",
        ).text
        amended_prefix = _render_template(
            _load_prompt_template("sa_amendment_prefix.md"),
            {"CURRENT_PRD": current_prd},
        )
        system_prompt = f"{amended_prefix}\n\n{sa_system}"
    else:
        system_prompt = sa_system

    compacted_conversation = compact_conversation(
        conversation_text,
        token_budget=max(int(budget.prompt_tokens * 0.48), 600),
    ).text

    return _render_template(
        _load_prompt_template("sa_chat.md"),
        {
            "SYSTEM_PROMPT": system_prompt,
            "CONVERSATION_TEXT": compacted_conversation,
        },
    )


def build_architect_prompt(*, model_choice: str, prd_draft: str) -> str:
    budget = _budget(model_choice)
    compacted_prd = compact_markdown(
        prd_draft,
        token_budget=max(int(budget.prompt_tokens * 0.72), 1200),
        label="PRD",
    ).text
    return _render_template(
        _load_prompt_template("architect.md"),
        {"PRD_DRAFT": compacted_prd},
    )


def build_user_stories_prompt(*, model_choice: str, prd_draft: str, architecture_draft: str) -> str:
    budget = _budget(model_choice)
    compacted_prd = compact_markdown(
        prd_draft,
        token_budget=max(int(budget.prompt_tokens * 0.36), 800),
        label="PRD",
    ).text
    compacted_architecture = compact_markdown(
        architecture_draft,
        token_budget=max(int(budget.prompt_tokens * 0.42), 1000),
        label="architecture",
    ).text
    return _render_template(
        _load_prompt_template("user_stories.md"),
        {
            "PRD_DRAFT": compacted_prd,
            "ARCHITECTURE_DRAFT": compacted_architecture,
        },
    )


def build_prd_refine_prompt(*, model_choice: str, prd_draft: str, instruction: str) -> str:
    budget = _budget(model_choice)
    compacted_prd = compact_markdown(
        prd_draft,
        token_budget=max(int(budget.prompt_tokens * 0.62), 1000),
        label="PRD",
        instruction_hint=instruction,
    ).text
    return _render_template(
        _load_prompt_template("prd_refine.md"),
        {
            "PRD_DRAFT": compacted_prd,
            "INSTRUCTION": instruction,
        },
    )


def build_architecture_refine_prompt(
    *,
    model_choice: str,
    prd_draft: str,
    architecture_draft: str,
    instruction: str,
) -> str:
    budget = _budget(model_choice)
    compacted_prd = compact_markdown(
        prd_draft,
        token_budget=max(int(budget.prompt_tokens * 0.24), 500),
        label="PRD",
        instruction_hint=instruction,
    ).text
    compacted_architecture = compact_markdown(
        architecture_draft,
        token_budget=max(int(budget.prompt_tokens * 0.48), 1000),
        label="current architecture",
        instruction_hint=instruction,
    ).text
    return _render_template(
        _load_prompt_template("architecture_refine.md"),
        {
            "PRD_DRAFT": compacted_prd,
            "ARCHITECTURE_DRAFT": compacted_architecture,
            "INSTRUCTION": instruction,
        },
    )


def build_user_stories_refine_prompt(
    *,
    model_choice: str,
    prd_draft: str,
    architecture_draft: str,
    user_stories_draft: str,
    instruction: str,
) -> str:
    budget = _budget(model_choice)
    compacted_prd = compact_markdown(
        prd_draft,
        token_budget=max(int(budget.prompt_tokens * 0.2), 500),
        label="PRD",
        instruction_hint=instruction,
    ).text
    compacted_architecture = compact_markdown(
        architecture_draft,
        token_budget=max(int(budget.prompt_tokens * 0.26), 700),
        label="architecture",
        instruction_hint=instruction,
    ).text
    compacted_stories = compact_markdown(
        user_stories_draft,
        token_budget=max(int(budget.prompt_tokens * 0.38), 900),
        label="current user stories",
        instruction_hint=instruction,
    ).text
    return _render_template(
        _load_prompt_template("user_stories_refine.md"),
        {
            "PRD_DRAFT": compacted_prd,
            "ARCHITECTURE_DRAFT": compacted_architecture,
            "USER_STORIES_DRAFT": compacted_stories,
            "INSTRUCTION": instruction,
        },
    )


def build_arch_chat_prompt(
    *,
    model_choice: str,
    prd_draft: str,
    architecture_draft: str,
    conversation_text: str,
    latest_user_input: str = "",
) -> str:
    budget = _budget(model_choice)
    compacted_prd = compact_markdown(
        prd_draft,
        token_budget=max(int(budget.prompt_tokens * 0.18), 400),
        label="PRD",
        instruction_hint=latest_user_input,
    ).text
    compacted_architecture = compact_markdown(
        architecture_draft,
        token_budget=max(int(budget.prompt_tokens * 0.42), 1000),
        label="architecture",
        instruction_hint=latest_user_input,
    ).text
    compacted_conversation = compact_conversation(
        conversation_text,
        token_budget=max(int(budget.prompt_tokens * 0.22), 500),
        label="architecture discussion history",
    ).text
    return _render_template(
        _load_prompt_template("arch_chat.md"),
        {
            "PRD_DRAFT": compacted_prd,
            "ARCHITECTURE_DRAFT": compacted_architecture,
            "CONVERSATION_TEXT": compacted_conversation,
        },
    )


def build_stories_chat_prompt(
    *,
    model_choice: str,
    prd_draft: str,
    architecture_draft: str,
    user_stories_draft: str,
    conversation_text: str,
    latest_user_input: str = "",
) -> str:
    budget = _budget(model_choice)
    compacted_prd = compact_markdown(
        prd_draft,
        token_budget=max(int(budget.prompt_tokens * 0.14), 350),
        label="PRD",
        instruction_hint=latest_user_input,
    ).text
    compacted_architecture = compact_markdown(
        architecture_draft,
        token_budget=max(int(budget.prompt_tokens * 0.22), 550),
        label="architecture",
        instruction_hint=latest_user_input,
    ).text
    compacted_stories = compact_markdown(
        user_stories_draft,
        token_budget=max(int(budget.prompt_tokens * 0.38), 900),
        label="current user stories",
        instruction_hint=latest_user_input,
    ).text
    compacted_conversation = compact_conversation(
        conversation_text,
        token_budget=max(int(budget.prompt_tokens * 0.16), 450),
        label="user story discussion history",
    ).text
    return _render_template(
        _load_prompt_template("stories_chat.md"),
        {
            "PRD_DRAFT": compacted_prd,
            "ARCHITECTURE_DRAFT": compacted_architecture,
            "USER_STORIES_DRAFT": compacted_stories,
            "CONVERSATION_TEXT": compacted_conversation,
        },
    )


def build_delivery_items_prompt(*, model_choice: str, user_stories_draft: str) -> str:
    budget = _budget(model_choice)
    compacted_stories = compact_markdown(
        user_stories_draft,
        token_budget=max(int(budget.prompt_tokens * 0.72), 1200),
        label="user stories",
    ).text
    return _render_template(
        _load_prompt_template("delivery_items.md"),
        {"USER_STORIES_DRAFT": compacted_stories},
    )
