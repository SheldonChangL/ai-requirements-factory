"""Delivery integration registry."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

try:
    from artifacts import DeliveryItem
except ModuleNotFoundError:
    from backend.artifacts import DeliveryItem


@dataclass(frozen=True)
class DeliveryPublishResult:
    success: bool
    target: str
    count: int
    created: list[str]


@dataclass(frozen=True)
class DeliveryIntegration:
    target: str
    preview: Callable[[list[DeliveryItem], dict[str, str]], list[dict]]
    publish: Callable[[list[DeliveryItem], dict[str, str]], DeliveryPublishResult]
    description: str
