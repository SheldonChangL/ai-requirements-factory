"""Workflow helpers separated from FastAPI route handlers."""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass

try:
    from artifacts import DeliveryItem, ProjectArtifacts, build_project_artifacts
    from model_adapters import invoke_model
    from prompts import build_delivery_items_prompt
except ModuleNotFoundError:
    from backend.artifacts import DeliveryItem, ProjectArtifacts, build_project_artifacts
    from backend.model_adapters import invoke_model
    from backend.prompts import build_delivery_items_prompt


REQUIREMENT_ID_RE = re.compile(r"\b(?:FR|NFR|OPS)-\d+\b", flags=re.IGNORECASE)
REQUIREMENT_LINE_RE = re.compile(
    r"^\s*[-*]?\s*`?(?P<id>(?:FR|NFR|OPS)-\d+)`?\s*[：:]\s*(?P<body>.+?)\s*$",
    flags=re.IGNORECASE,
)
STORY_POINTS_RE = re.compile(r"Story Points\*?\*?\s*[：:]\s*(\d+)", flags=re.IGNORECASE)
SENIOR_RD_RE_LIST = [
    re.compile(
        r"(?:Senior\s*RD(?:\s*(?:Estimate|Effort|Duration))?|Senior\s*Engineer(?:\s*(?:Estimate|Effort|Duration))?)\*?\*?\s*[：:]\s*([0-9]+(?:\.[0-9]+)?)",
        flags=re.IGNORECASE,
    ),
    re.compile(
        r"(?:資深\s*RD(?:實作)?(?:工期|估算|估計|時間)|資深工程師(?:工期|估算|估計|時間)|資深研發(?:工期|估算|估計|時間)|實作工期)\*?\*?\s*[：:]\s*([0-9]+(?:\.[0-9]+)?)",
        flags=re.IGNORECASE,
    ),
]
HALF_DAY_INCREMENT = 0.5
STORY_POINTS_TO_DAYS = {
    1: 0.5,
    2: 1.0,
    3: 1.5,
    5: 3.0,
    8: 5.0,
    13: 8.0,
}
DEFAULT_STORY_POINTS = 3
DEFAULT_SENIOR_RD_DAYS = STORY_POINTS_TO_DAYS[DEFAULT_STORY_POINTS]
TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9_]{2,}|[\u4e00-\u9fff]{2,}")
TOKEN_STOPWORDS = {
    "the", "and", "for", "with", "from", "into", "that", "this", "user", "users",
    "shall", "should", "must", "need", "needs", "want", "wants", "have", "has",
    "will", "can", "able", "system", "support", "supports", "allow", "allows",
    "using", "used", "use", "data", "flow", "page", "view", "create", "update",
    "delete", "story", "stories", "epic", "group", "feature", "module", "service",
    "功能", "系統", "需要", "支援", "提供", "使用者", "用戶", "畫面", "頁面", "流程",
    "資料", "管理", "建立", "更新", "刪除", "查詢", "需求", "模組", "功能需求",
}


@dataclass
class RequirementRef:
    requirement_id: str
    text: str
    tokens: set[str]


def strip_code_fences(raw_text: str) -> str:
    text = raw_text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(
            line for line in lines if not line.strip().startswith("```")
        ).strip()
    return text


def _round_half_day(value: float) -> float:
    rounded = round(value / HALF_DAY_INCREMENT) * HALF_DAY_INCREMENT
    return max(HALF_DAY_INCREMENT, rounded)


def _coerce_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        match = re.search(r"\d+", value)
        if match:
            return int(match.group(0))
    return None


def _coerce_float(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        match = re.search(r"\d+(?:\.\d+)?", value)
        if match:
            return float(match.group(0))
    return None


def _days_from_story_points(points: int | None) -> float:
    if points is None:
        return DEFAULT_SENIOR_RD_DAYS
    if points in STORY_POINTS_TO_DAYS:
        return STORY_POINTS_TO_DAYS[points]
    sorted_points = sorted(STORY_POINTS_TO_DAYS)
    nearest = min(sorted_points, key=lambda candidate: abs(candidate - points))
    return STORY_POINTS_TO_DAYS[nearest]


def _story_points_from_days(days: float | None) -> int:
    if days is None:
        return DEFAULT_STORY_POINTS
    normalized_days = _round_half_day(days)
    return min(
        STORY_POINTS_TO_DAYS,
        key=lambda candidate: (abs(STORY_POINTS_TO_DAYS[candidate] - normalized_days), candidate),
    )


def _normalize_story_points(value: object) -> int:
    parsed = _coerce_int(value)
    if parsed is None or parsed <= 0:
        return DEFAULT_STORY_POINTS
    if parsed in STORY_POINTS_TO_DAYS:
        return parsed
    return min(
        STORY_POINTS_TO_DAYS,
        key=lambda candidate: (abs(candidate - parsed), candidate),
    )


def _normalize_senior_rd_days(value: object, *, fallback_story_points: int | None = None) -> float:
    parsed = _coerce_float(value)
    if parsed is None or parsed <= 0:
        return _days_from_story_points(fallback_story_points)
    return _round_half_day(parsed)


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


def _extract_story_points(body: str) -> int | None:
    match = STORY_POINTS_RE.search(body)
    if not match:
        return None
    try:
        return int(match.group(1))
    except ValueError:
        return None


def _extract_senior_rd_days(body: str) -> float | None:
    for pattern in SENIOR_RD_RE_LIST:
        match = pattern.search(body)
        if not match:
            continue
        try:
            return _normalize_senior_rd_days(float(match.group(1)))
        except ValueError:
            return None
    return None


def _extract_requirement_refs(text: str) -> list[str]:
    refs: list[str] = []
    seen: set[str] = set()
    for match in REQUIREMENT_ID_RE.finditer(text):
        ref = match.group(0).upper()
        if ref in seen:
            continue
        seen.add(ref)
        refs.append(ref)
    return refs


def _tokenize_for_matching(text: str) -> set[str]:
    tokens: set[str] = set()
    lowered = text.lower()
    for token in TOKEN_RE.findall(lowered):
        normalized = token.strip("_-")
        if len(normalized) < 2 or normalized in TOKEN_STOPWORDS:
            continue
        if normalized.isdigit():
            continue
        tokens.add(normalized)
    return tokens


def parse_requirement_catalog(prd_draft: str) -> list[RequirementRef]:
    catalog: list[RequirementRef] = []
    current_heading = ""
    for raw_line in prd_draft.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("#"):
            current_heading = re.sub(r"^#+\s*", "", line).strip()
            continue
        match = REQUIREMENT_LINE_RE.match(line.replace("**", ""))
        if not match:
            continue
        requirement_id = match.group("id").upper()
        description = _compact_whitespace(match.group("body"))
        context = f"{current_heading} {description}".strip()
        tokens = _tokenize_for_matching(context)
        catalog.append(
            RequirementRef(
                requirement_id=requirement_id,
                text=description,
                tokens=tokens,
            )
        )
    return catalog


def _infer_requirement_refs(title: str, body: str, catalog: list[RequirementRef]) -> list[str]:
    if not catalog:
        return []
    story_tokens = _tokenize_for_matching(f"{title} {body}")
    if not story_tokens:
        return []

    scored: list[tuple[int, float, str]] = []
    for requirement in catalog:
        overlap = story_tokens & requirement.tokens
        if not overlap:
            continue
        overlap_count = len(overlap)
        coverage = overlap_count / max(len(requirement.tokens), 1)
        scored.append((overlap_count, coverage, requirement.requirement_id))

    if not scored:
        return []

    scored.sort(key=lambda item: (-item[0], -item[1], item[2]))
    best_overlap = scored[0][0]
    if best_overlap < 2:
        return []

    inferred: list[str] = []
    for overlap_count, coverage, requirement_id in scored:
        if overlap_count < best_overlap - 1:
            break
        if overlap_count < 2 and coverage < 0.34:
            continue
        inferred.append(requirement_id)
        if len(inferred) >= 3:
            break
    return inferred


def _build_story_body(body: str) -> str:
    cleaned = body.strip()
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned


def _extract_requirement_refs_from_raw(value: object) -> list[str]:
    if isinstance(value, list):
        refs = [str(item).strip().upper() for item in value if str(item).strip()]
        return _extract_requirement_refs(" ".join(refs))
    if isinstance(value, str):
        return _extract_requirement_refs(value)
    return []


def normalize_delivery_items(raw_items: list[dict], prd_draft: str = "") -> list[DeliveryItem]:
    requirement_catalog = parse_requirement_catalog(prd_draft)
    normalized: list[DeliveryItem] = []
    for raw in raw_items:
        title = str(raw.get("title", "Untitled item")).strip()[:120] or "Untitled item"
        body = str(raw.get("body", title)).strip() or title
        group = str(raw.get("group", "General")).strip() or "General"

        senior_rd_days = _normalize_senior_rd_days(
            raw.get("senior_rd_days", raw.get("senior_rd_estimate")),
            fallback_story_points=_coerce_int(raw.get("estimate")),
        )
        estimate = _normalize_story_points(raw.get("estimate", _story_points_from_days(senior_rd_days)))
        senior_rd_days = _normalize_senior_rd_days(senior_rd_days, fallback_story_points=estimate)

        requirement_refs = _extract_requirement_refs_from_raw(
            raw.get("requirement_refs", raw.get("requirement_ids", []))
        )
        if not requirement_refs:
            requirement_refs = _extract_requirement_refs(f"{title}\n{body}")
        requirement_source = "explicit"
        if not requirement_refs:
            requirement_refs = _infer_requirement_refs(title, body, requirement_catalog)
            requirement_source = "inferred" if requirement_refs else "unmapped"

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
                senior_rd_days=senior_rd_days,
                requirement_refs=requirement_refs,
                requirement_source=requirement_source,
            )
        )
    return normalized


def heuristic_delivery_items_from_markdown(
    user_stories_draft: str,
    prd_draft: str = "",
) -> list[DeliveryItem]:
    requirement_catalog = parse_requirement_catalog(prd_draft)
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
            explicit_story_points = _extract_story_points(story_body)
            explicit_senior_rd_days = _extract_senior_rd_days(story_body)

            if explicit_senior_rd_days is not None:
                senior_rd_days = explicit_senior_rd_days
                estimate = _normalize_story_points(
                    explicit_story_points if explicit_story_points is not None else _story_points_from_days(senior_rd_days)
                )
            else:
                estimate = _normalize_story_points(explicit_story_points)
                senior_rd_days = _normalize_senior_rd_days(None, fallback_story_points=estimate)

            requirement_refs = _extract_requirement_refs(f"{story_heading}\n{story_body}")
            requirement_source = "explicit"
            if not requirement_refs:
                requirement_refs = _infer_requirement_refs(title, story_body, requirement_catalog)
                requirement_source = "inferred" if requirement_refs else "unmapped"

            labels = ["story", f"group:{_compact_whitespace(group)[:40]}"]
            body = _build_story_body(story_body) or title

            items.append(
                DeliveryItem(
                    title=title[:120],
                    body=body,
                    estimate=estimate,
                    group=group,
                    labels=labels,
                    senior_rd_days=senior_rd_days,
                    requirement_refs=requirement_refs,
                    requirement_source=requirement_source,
                )
            )
    return items


def parse_delivery_items(
    user_stories_draft: str,
    model_choice: str,
    prd_draft: str = "",
) -> list[DeliveryItem]:
    heuristic_items = heuristic_delivery_items_from_markdown(user_stories_draft, prd_draft)
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
        return normalize_delivery_items(parsed, prd_draft)
    except (RuntimeError, ValueError, json.JSONDecodeError):
        fallback_items = heuristic_delivery_items_from_markdown(user_stories_draft, prd_draft)
        if fallback_items:
            return fallback_items
        raise


def project_artifacts_from_state(thread_id: str, values: dict) -> ProjectArtifacts:
    return build_project_artifacts(thread_id, values)


def delivery_preview_payload(items: list[DeliveryItem]) -> list[dict]:
    return [asdict(item) for item in items]
