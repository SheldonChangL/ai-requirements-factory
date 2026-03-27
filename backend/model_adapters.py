"""Model adapter registry and extension contract.

Adapter contract:

1. Register a unique `model_choice` string in `MODEL_ADAPTERS`.
2. Provide an `invoke(prompt: str) -> str` callable that returns plain text.
3. Provide an `is_available() -> bool` callable for lightweight health checks.
4. Raise `RuntimeError` for provider-specific invocation failures.
"""

from __future__ import annotations

import json
import os
import subprocess
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Callable

from langchain_ollama import ChatOllama

OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")
OLLAMA_BASE_URL = os.getenv("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
OPENAI_COMPAT_BASE_URL = os.getenv("OPENAI_COMPAT_BASE_URL", "https://api.openai.com/v1").rstrip("/")
OPENAI_COMPAT_API_KEY = os.getenv("OPENAI_COMPAT_API_KEY", "").strip()
OPENAI_COMPAT_MODEL = os.getenv("OPENAI_COMPAT_MODEL", "").strip()


@dataclass(frozen=True)
class ModelAdapter:
    model_choice: str
    invoke: Callable[[str], str]
    is_available: Callable[[], bool]
    description: str
    max_context_tokens: int
    prompt_budget_tokens: int
    response_budget_tokens: int


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


def _openai_compat_headers() -> dict[str, str]:
    if not OPENAI_COMPAT_API_KEY:
        raise RuntimeError("OPENAI_COMPAT_API_KEY is not set.")
    return {
        "Authorization": f"Bearer {OPENAI_COMPAT_API_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _extract_openai_compat_content(payload: dict) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise RuntimeError("OpenAI-compatible API returned no choices.")
    message = choices[0].get("message", {})
    content = message.get("content", "")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        text_parts: list[str] = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                text = item.get("text", "")
                if isinstance(text, str):
                    text_parts.append(text)
        joined = "".join(text_parts).strip()
        if joined:
            return joined
    raise RuntimeError("OpenAI-compatible API returned unsupported message content.")


def _invoke_openai_compatible(prompt: str) -> str:
    if not OPENAI_COMPAT_MODEL:
        raise RuntimeError("OPENAI_COMPAT_MODEL is not set.")

    payload = {
        "model": OPENAI_COMPAT_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
    }
    request = urllib.request.Request(
        f"{OPENAI_COMPAT_BASE_URL}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers=_openai_compat_headers(),
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            body = json.loads(response.read())
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"OpenAI-compatible API error (HTTP {exc.code}): {error_body}"
        ) from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(
            f"Could not reach OpenAI-compatible API at '{OPENAI_COMPAT_BASE_URL}': {exc.reason}"
        ) from exc

    output = _extract_openai_compat_content(body)
    if not output:
        raise RuntimeError("OpenAI-compatible API returned empty output.")
    return output


def _check_openai_compatible() -> bool:
    if not OPENAI_COMPAT_API_KEY:
        return False
    request = urllib.request.Request(
        f"{OPENAI_COMPAT_BASE_URL}/models",
        headers=_openai_compat_headers(),
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status == 200
    except Exception:
        return False


MODEL_ADAPTERS: dict[str, ModelAdapter] = {
    "ollama": ModelAdapter(
        model_choice="ollama",
        invoke=_invoke_ollama,
        is_available=_check_ollama,
        description="Local Ollama model via LangChain",
        max_context_tokens=8192,
        prompt_budget_tokens=6000,
        response_budget_tokens=1200,
    ),
    "gemini-cli": ModelAdapter(
        model_choice="gemini-cli",
        invoke=lambda prompt: _invoke_cli(prompt, "gemini", "gemini CLI"),
        is_available=lambda: _check_cli("gemini"),
        description="Gemini CLI subprocess adapter",
        max_context_tokens=32768,
        prompt_budget_tokens=24000,
        response_budget_tokens=2000,
    ),
    "claude-cli": ModelAdapter(
        model_choice="claude-cli",
        invoke=lambda prompt: _invoke_cli(prompt, "claude", "claude CLI"),
        is_available=lambda: _check_cli("claude"),
        description="Claude CLI subprocess adapter",
        max_context_tokens=200000,
        prompt_budget_tokens=140000,
        response_budget_tokens=4000,
    ),
    "codex-cli": ModelAdapter(
        model_choice="codex-cli",
        invoke=lambda prompt: _invoke_cli(prompt, "codex", "codex CLI"),
        is_available=lambda: _check_cli("codex"),
        description="Codex CLI subprocess adapter",
        max_context_tokens=128000,
        prompt_budget_tokens=90000,
        response_budget_tokens=4000,
    ),
    "openai-compatible": ModelAdapter(
        model_choice="openai-compatible",
        invoke=_invoke_openai_compatible,
        is_available=_check_openai_compatible,
        description="OpenAI-compatible chat completions adapter",
        max_context_tokens=128000,
        prompt_budget_tokens=90000,
        response_budget_tokens=4000,
    ),
}


def get_supported_model_choices() -> list[str]:
    return list(MODEL_ADAPTERS.keys())


def get_model_adapter(model_choice: str) -> ModelAdapter:
    normalized = model_choice.strip().lower()
    adapter = MODEL_ADAPTERS.get(normalized)
    if adapter is None:
        raise ValueError(
            f"Unsupported model_choice '{model_choice}'. "
            f"Valid options: {sorted(MODEL_ADAPTERS)}."
        )
    return adapter


def invoke_model(model_choice: str, prompt: str) -> str:
    adapter = get_model_adapter(model_choice)
    return adapter.invoke(prompt)
