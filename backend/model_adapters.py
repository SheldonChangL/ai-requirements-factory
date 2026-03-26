"""Model adapter registry and extension contract.

Adapter contract:

1. Register a unique `model_choice` string in `MODEL_ADAPTERS`.
2. Provide an `invoke(prompt: str) -> str` callable that returns plain text.
3. Provide an `is_available() -> bool` callable for lightweight health checks.
4. Raise `RuntimeError` for provider-specific invocation failures.
"""

from __future__ import annotations

import os
import subprocess
import urllib.request
from dataclasses import dataclass
from typing import Callable

from langchain_ollama import ChatOllama

OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")
OLLAMA_BASE_URL = os.getenv("OLLAMA_HOST", "http://localhost:11434").rstrip("/")


@dataclass(frozen=True)
class ModelAdapter:
    model_choice: str
    invoke: Callable[[str], str]
    is_available: Callable[[], bool]
    description: str


def _invoke_ollama(prompt: str) -> str:
    llm = ChatOllama(
        model=OLLAMA_MODEL,
        base_url=OLLAMA_BASE_URL,
        temperature=0.2,
    )
    response = llm.invoke(prompt)
    return response.content


def _invoke_cli(prompt: str, command: str, display_name: str) -> str:
    try:
        result = subprocess.run(
            [command, "-p", prompt],
            capture_output=True,
            text=True,
            timeout=120,
            input="",
        )
        if result.returncode != 0:
            stderr_msg = result.stderr.strip() or "unknown error"
            raise RuntimeError(
                f"{display_name} exited with code {result.returncode}: {stderr_msg}"
            )
        output = result.stdout.strip()
        if not output:
            raise RuntimeError(f"{display_name} returned empty output.")
        return output
    except FileNotFoundError as exc:
        raise RuntimeError(
            f"{display_name} not found. Install it and ensure it is on your PATH."
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"{display_name} timed out after 120 seconds.") from exc


def _check_ollama() -> bool:
    try:
        req = urllib.request.urlopen(f"{OLLAMA_BASE_URL}/api/tags", timeout=3)
        return req.status == 200
    except Exception:
        return False


def _check_cli(command: str) -> bool:
    try:
        result = subprocess.run(
            [command, "--version"],
            capture_output=True,
            timeout=3,
            input=b"",
        )
        return result.returncode == 0
    except Exception:
        return False


MODEL_ADAPTERS: dict[str, ModelAdapter] = {
    "ollama": ModelAdapter(
        model_choice="ollama",
        invoke=_invoke_ollama,
        is_available=_check_ollama,
        description="Local Ollama model via LangChain",
    ),
    "gemini-cli": ModelAdapter(
        model_choice="gemini-cli",
        invoke=lambda prompt: _invoke_cli(prompt, "gemini", "gemini CLI"),
        is_available=lambda: _check_cli("gemini"),
        description="Gemini CLI subprocess adapter",
    ),
    "claude-cli": ModelAdapter(
        model_choice="claude-cli",
        invoke=lambda prompt: _invoke_cli(prompt, "claude", "claude CLI"),
        is_available=lambda: _check_cli("claude"),
        description="Claude CLI subprocess adapter",
    ),
    "codex-cli": ModelAdapter(
        model_choice="codex-cli",
        invoke=lambda prompt: _invoke_cli(prompt, "codex", "codex CLI"),
        is_available=lambda: _check_cli("codex"),
        description="Codex CLI subprocess adapter",
    ),
}


def get_supported_model_choices() -> list[str]:
    return list(MODEL_ADAPTERS.keys())


def invoke_model(model_choice: str, prompt: str) -> str:
    normalized = model_choice.strip().lower()
    adapter = MODEL_ADAPTERS.get(normalized)
    if adapter is None:
        raise ValueError(
            f"Unsupported model_choice '{model_choice}'. "
            f"Valid options: {sorted(MODEL_ADAPTERS)}."
        )
    return adapter.invoke(prompt)
