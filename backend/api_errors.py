"""Structured API error helpers."""

from __future__ import annotations


def error_detail(category: str, message: str, **extra: object) -> dict[str, object]:
    detail: dict[str, object] = {
        "category": category,
        "message": message,
    }
    detail.update(extra)
    return detail
