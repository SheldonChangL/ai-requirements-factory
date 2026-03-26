"""Concrete delivery integration registry."""

from __future__ import annotations

from integrations.github import preview_github, publish_github
from integrations.jira import preview_jira, publish_jira
from integrations.registry import DeliveryIntegration


DELIVERY_INTEGRATIONS: dict[str, DeliveryIntegration] = {
    "jira": DeliveryIntegration(
        target="jira",
        preview=preview_jira,
        publish=publish_jira,
        description="Publish delivery items to Jira issues",
    ),
    "github": DeliveryIntegration(
        target="github",
        preview=preview_github,
        publish=publish_github,
        description="Publish delivery items to GitHub issues",
    ),
}
