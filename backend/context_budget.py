"""Prompt context budgeting helpers.

These helpers provide a pragmatic middle ground between sending the full
conversation/artifact every time and implementing a full retrieval system.

Goals:
- keep prompts inside model-specific budgets
- preserve recent conversational turns
- preserve high-value markdown sections and headings
- bias section selection toward the user's latest instruction
"""

from __future__ import annotations

import re
from dataclasses import dataclass


DEFAULT_PROMPT_BUDGET_TOKENS = 6000


@dataclass(frozen=True)
class PromptBudget:
    prompt_tokens: int
    response_tokens: int


@dataclass(frozen=True)
class CompactedText:
    text: str
    estimated_tokens: int
    truncated: bool


def estimate_tokens(text: str) -> int:
    normalized = text.strip()
    if not normalized:
        return 0
    wordish = re.findall(r"\S+", normalized)
    # Crude heuristic that behaves reasonably for English + markdown + CJK.
    return max(len(normalized) // 4, int(len(wordish) * 1.25), 1)


def _char_budget_from_tokens(token_budget: int) -> int:
    return max(token_budget * 4, 0)


def _clip_by_chars(text: str, token_budget: int, prefer_tail: bool = False) -> str:
    if token_budget <= 0:
        return ""
    char_budget = _char_budget_from_tokens(token_budget)
    normalized = text.strip()
    if len(normalized) <= char_budget:
        return normalized

    if char_budget < 120:
        snippet = normalized[-char_budget:] if prefer_tail else normalized[:char_budget]
        return snippet.strip()

    keep = max(char_budget - 32, 0)
    if prefer_tail:
        return f"[...truncated...]\n{normalized[-keep:].strip()}"

    head = normalized[: keep // 2].strip()
    tail = normalized[-(keep - len(head)) :].strip()
    return f"{head}\n[...truncated...]\n{tail}".strip()


def _extract_instruction_keywords(*texts: str) -> set[str]:
    keywords: set[str] = set()
    for text in texts:
        for word in re.findall(r"[A-Za-z][A-Za-z0-9_-]{2,}", text.lower()):
            if word not in {
                "the",
                "and",
                "for",
                "with",
                "that",
                "this",
                "from",
                "into",
                "user",
                "should",
                "must",
                "need",
                "want",
                "add",
                "remove",
                "change",
                "update",
                "make",
                "keep",
                "stage",
            }:
                keywords.add(word)
    return keywords


def _split_markdown_sections(text: str) -> list[tuple[str, str]]:
    stripped = text.strip()
    if not stripped:
        return []

    lines = stripped.splitlines()
    sections: list[tuple[str, list[str]]] = []
    current_heading = "Introduction"
    current_lines: list[str] = []

    for line in lines:
        if line.lstrip().startswith("#"):
            if current_lines:
                sections.append((current_heading, current_lines))
            current_heading = line.strip()
            current_lines = [line]
        else:
            current_lines.append(line)

    if current_lines:
        sections.append((current_heading, current_lines))

    return [(heading, "\n".join(content).strip()) for heading, content in sections if "\n".join(content).strip()]


def compact_markdown(
    text: str,
    *,
    token_budget: int,
    label: str,
    instruction_hint: str = "",
) -> CompactedText:
    normalized = text.strip()
    if not normalized:
      return CompactedText(text="", estimated_tokens=0, truncated=False)

    estimated = estimate_tokens(normalized)
    if estimated <= token_budget:
        return CompactedText(text=normalized, estimated_tokens=estimated, truncated=False)

    sections = _split_markdown_sections(normalized)
    if len(sections) <= 1:
        clipped = _clip_by_chars(normalized, token_budget)
        note = f"[Context note: condensed {label} to fit the model context budget.]\n"
        final = f"{note}{clipped}".strip()
        return CompactedText(
            text=final,
            estimated_tokens=estimate_tokens(final),
            truncated=True,
        )

    keywords = _extract_instruction_keywords(instruction_hint, label)
    scored_sections: list[tuple[tuple[int, int, int], str, str]] = []
    for index, (heading, content) in enumerate(sections):
        heading_lower = heading.lower()
        score = 0
        if index == 0:
            score += 6
        if any(keyword in heading_lower for keyword in keywords):
            score += 8
        if any(core in heading_lower for core in ("overview", "goal", "objective", "scope", "architecture", "api", "security", "performance", "epic", "story", "requirement")):
            score += 3
        score += max(0, 10 - index)
        scored_sections.append(((score, -index, len(content)), heading, content))

    selected: list[tuple[str, str]] = []
    used_tokens = estimate_tokens(f"[Context note: condensed {label} to fit the model context budget.]")
    for _, heading, content in sorted(scored_sections, reverse=True):
        section_text = content if content.startswith("#") else f"{heading}\n{content}"
        section_tokens = estimate_tokens(section_text)
        if not selected or used_tokens + section_tokens <= token_budget:
            selected.append((heading, content))
            used_tokens += section_tokens

    if not selected:
        heading, content = sections[0]
        compacted = _clip_by_chars(content, max(token_budget - 20, 40))
        selected = [(heading, compacted)]

    rendered_sections: list[str] = []
    per_section_budget = max((token_budget - 24) // max(len(selected), 1), 80)
    selected_headings = {heading for heading, _ in selected}
    omitted_count = len(sections) - len(selected)

    for heading, content in sections:
        if heading not in selected_headings:
            continue
        section_text = content if content.startswith("#") else f"{heading}\n{content}"
        if estimate_tokens(section_text) > per_section_budget:
            section_text = _clip_by_chars(section_text, per_section_budget)
        rendered_sections.append(section_text.strip())

    note = f"[Context note: condensed {label}"
    if omitted_count > 0:
        note += f"; omitted {omitted_count} lower-priority section(s)"
    note += ".]"
    final = f"{note}\n\n" + "\n\n".join(rendered_sections)
    return CompactedText(
        text=final.strip(),
        estimated_tokens=estimate_tokens(final),
        truncated=True,
    )


def compact_conversation(
    conversation_text: str,
    *,
    token_budget: int,
    label: str = "conversation history",
) -> CompactedText:
    normalized = conversation_text.strip()
    if not normalized:
        return CompactedText(text="", estimated_tokens=0, truncated=False)

    estimated = estimate_tokens(normalized)
    if estimated <= token_budget:
        return CompactedText(text=normalized, estimated_tokens=estimated, truncated=False)

    lines = [line.strip() for line in normalized.splitlines() if line.strip()]
    if not lines:
        return CompactedText(text="", estimated_tokens=0, truncated=False)

    recent_lines: list[str] = []
    recent_budget = max(int(token_budget * 0.55), 120)
    used_recent = 0
    for line in reversed(lines):
        line_tokens = estimate_tokens(line)
        if recent_lines and used_recent + line_tokens > recent_budget:
            break
        recent_lines.append(line)
        used_recent += line_tokens
    recent_lines.reverse()

    earlier_lines = lines[: max(0, len(lines) - len(recent_lines))]
    summary_lines: list[str] = []
    summary_budget = max(token_budget - used_recent - 20, 80)
    used_summary = 0
    for line in earlier_lines:
        speaker, _, content = line.partition(":")
        compacted = re.sub(r"\s+", " ", content.strip())
        if len(compacted) > 180:
            compacted = f"{compacted[:177].rstrip()}..."
        bullet = f"- {speaker.strip()}: {compacted}".strip()
        bullet_tokens = estimate_tokens(bullet)
        if summary_lines and used_summary + bullet_tokens > summary_budget:
            break
        summary_lines.append(bullet)
        used_summary += bullet_tokens

    pieces = [f"[Context note: condensed {label}; older turns were summarized.]"]
    if summary_lines:
        pieces.append("Earlier summary:\n" + "\n".join(summary_lines))
    if recent_lines:
        pieces.append("Recent turns:\n" + "\n".join(recent_lines))
    final = "\n\n".join(piece for piece in pieces if piece.strip()).strip()
    return CompactedText(
        text=final,
        estimated_tokens=estimate_tokens(final),
        truncated=True,
    )


def derive_context_budget(
    *,
    prompt_budget_tokens: int,
    response_budget_tokens: int,
    prompt_overhead_tokens: int = 900,
) -> PromptBudget:
    effective_prompt = max(prompt_budget_tokens - response_budget_tokens - prompt_overhead_tokens, 1200)
    return PromptBudget(prompt_tokens=effective_prompt, response_tokens=response_budget_tokens)
