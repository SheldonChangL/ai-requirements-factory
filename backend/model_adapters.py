"""Model adapter registry and extension contract.

Adapter contract:

1. Register a unique `model_choice` string in `MODEL_ADAPTERS`.
2. Provide an `invoke(prompt: str) -> str` callable that returns plain text.
3. Provide an `is_available() -> bool` callable for lightweight health checks.
4. Raise `RuntimeError` for provider-specific invocation failures.
"""

from __future__ import annotations

import os
import re
import shlex
import subprocess
import tempfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from langchain_ollama import ChatOllama


ANSI_ESCAPE_RE = re.compile(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\].*?(?:\x07|\x1b\\))")


def _load_env_file() -> None:
    env_path = Path(__file__).with_name(".env")
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key:
            continue
        value = value.strip().strip("'").strip('"')
        os.environ.setdefault(key, value)


_load_env_file()


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "gemma4:e4b")
OLLAMA_BASE_URL = os.getenv("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
GEMINI_CLI_TIMEOUT_SECONDS = _env_int("GEMINI_CLI_TIMEOUT_SECONDS", 360)
CLAUDE_CLI_TIMEOUT_SECONDS = _env_int("CLAUDE_CLI_TIMEOUT_SECONDS", 360)
CODEX_CLI_TIMEOUT_SECONDS = _env_int("CODEX_CLI_TIMEOUT_SECONDS", 360)


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


def _clean_cli_output(output: str) -> str:
    cleaned = output.replace("\r\n", "\n").replace("\r", "\n")
    cleaned = ANSI_ESCAPE_RE.sub("", cleaned)
    return cleaned.strip()


def _runtime_env_for_cli(command: str) -> dict[str, str]:
    env = os.environ.copy()
    if command == "claude" and not env.get("SSH_AUTH_SOCK"):
        try:
            result = subprocess.run(
                ["launchctl", "getenv", "SSH_AUTH_SOCK"],
                capture_output=True,
                text=True,
                timeout=2,
                input="",
            )
            sock = result.stdout.strip()
            if result.returncode == 0 and sock:
                env["SSH_AUTH_SOCK"] = sock
        except Exception:
            pass
    return env


def _invoke_cli(
    prompt: str,
    command: str,
    display_name: str,
    timeout_seconds: int,
    extra_args: list[str] | None = None,
    use_login_shell: bool = False,
) -> str:
    command_argv = [command, *(extra_args or []), "-p", prompt]
    argv = command_argv
    if use_login_shell:
        shell_path = os.getenv("SHELL", "/bin/zsh")
        argv = [shell_path, "-lc", " ".join(shlex.quote(arg) for arg in command_argv)]
    try:
        result = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            input="",
            env=_runtime_env_for_cli(command),
        )
        if result.returncode != 0:
            stderr_msg = result.stderr.strip()
            stdout_msg = result.stdout.strip()
            detail = stderr_msg or stdout_msg or "unknown error"
            if command == "claude" and "Not logged in" in detail:
                detail = (
                    f"{detail}. Run `claude auth login` in the same host account "
                    "that starts the backend, then restart the backend."
                )
            raise RuntimeError(
                f"{display_name} exited with code {result.returncode}: {detail}"
            )
        output = result.stdout.strip()
        if not output:
            raise RuntimeError(f"{display_name} returned empty output.")
        return _clean_cli_output(output)
    except FileNotFoundError as exc:
        raise RuntimeError(
            f"{display_name} not found. Install it and ensure it is on your PATH."
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"{display_name} timed out after {timeout_seconds} seconds.") from exc


def _invoke_codex_cli(prompt: str) -> str:
    output_path = None
    try:
        with tempfile.NamedTemporaryFile("w+", delete=False) as output_file:
            output_path = output_file.name

        result = subprocess.run(
            [
                "codex",
                "exec",
                "--skip-git-repo-check",
                "--sandbox",
                "read-only",
                "-o",
                output_path,
                prompt,
            ],
            capture_output=True,
            text=True,
            timeout=CODEX_CLI_TIMEOUT_SECONDS,
            input="",
        )
        if result.returncode != 0:
            stderr_msg = result.stderr.strip() or result.stdout.strip() or "unknown error"
            raise RuntimeError(f"codex CLI exited with code {result.returncode}: {stderr_msg}")

        with open(output_path, "r", encoding="utf-8") as handle:
            output = handle.read().strip()
        if not output:
            raise RuntimeError("codex CLI returned empty output.")
        return output
    except FileNotFoundError as exc:
        raise RuntimeError(
            "codex CLI not found. Install it and ensure it is on your PATH."
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(
            f"codex CLI timed out after {CODEX_CLI_TIMEOUT_SECONDS} seconds."
        ) from exc
    finally:
        if output_path:
            try:
                os.remove(output_path)
            except OSError:
                pass


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


def _check_claude_cli() -> bool:
    if not _check_cli("claude"):
        return False

    if ANTHROPIC_API_KEY:
        return True

    try:
        result = subprocess.run(
            ["claude", "auth", "status"],
            capture_output=True,
            text=True,
            timeout=5,
            input="",
            env=_runtime_env_for_cli("claude"),
        )
        return result.returncode == 0 and '"loggedIn": true' in result.stdout
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
        invoke=lambda prompt: _invoke_cli(
            prompt,
            "gemini",
            "gemini CLI",
            GEMINI_CLI_TIMEOUT_SECONDS,
        ),
        is_available=lambda: _check_cli("gemini"),
        description="Gemini CLI subprocess adapter",
        max_context_tokens=32768,
        prompt_budget_tokens=24000,
        response_budget_tokens=2000,
    ),
    "claude-cli": ModelAdapter(
        model_choice="claude-cli",
        invoke=lambda prompt: _invoke_cli(
            prompt,
            "claude",
            "claude CLI",
            CLAUDE_CLI_TIMEOUT_SECONDS,
            ["--bare"] if ANTHROPIC_API_KEY else None,
            use_login_shell=not ANTHROPIC_API_KEY,
        ),
        is_available=_check_claude_cli,
        description="Claude CLI subprocess adapter",
        max_context_tokens=200000,
        prompt_budget_tokens=140000,
        response_budget_tokens=4000,
    ),
    "codex-cli": ModelAdapter(
        model_choice="codex-cli",
        invoke=_invoke_codex_cli,
        is_available=lambda: _check_cli("codex"),
        description="Codex CLI subprocess adapter",
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
