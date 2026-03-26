import asyncio
import base64
import io
import json as json_lib
import os
import sqlite3
import subprocess
import urllib.error
import urllib.request
from typing import Annotated, TypedDict

import fitz  # PyMuPDF
import openpyxl
from docx import Document as DocxDocument
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_ollama import ChatOllama
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, StateGraph
from langgraph.graph.message import add_messages
from pydantic import BaseModel

from prompts import (
    build_architect_prompt,
    build_sa_prompt,
    build_story_parse_prompt,
    build_user_stories_prompt,
)

OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")
OLLAMA_BASE_URL = os.getenv("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
CORS_ALLOW_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ALLOW_ORIGINS", "*").split(",")
    if origin.strip()
]


# ---------------------------------------------------------------------------
# SQLite persistence
# ---------------------------------------------------------------------------

conn = sqlite3.connect("ai_factory.db", check_same_thread=False)
memory = SqliteSaver(conn)
memory.setup()


# ---------------------------------------------------------------------------
# Model Adapter
# ---------------------------------------------------------------------------

def model_adapter(model_choice: str, prompt: str) -> str:
    """
    Route a prompt to the appropriate AI backend and return the response text.

    Supported model_choice values:
      - "ollama"      : Uses ChatOllama (llama3) via LangChain
      - "gemini-cli"  : Uses the `gemini` CLI tool via subprocess
      - "claude-cli"  : Uses the `claude` CLI tool via subprocess
      - "codex-cli"   : Uses the `codex` CLI tool via subprocess
    """
    model_choice = model_choice.strip().lower()

    # --- Ollama (llama3 via LangChain) ---
    if model_choice == "ollama":
        llm = ChatOllama(
            model=OLLAMA_MODEL,
            base_url=OLLAMA_BASE_URL,
            temperature=0.2,
        )
        response = llm.invoke(prompt)
        return response.content

    # --- Gemini CLI ---
    if model_choice == "gemini-cli":
        try:
            result = subprocess.run(
                ["gemini", "-p", prompt],
                capture_output=True,
                text=True,
                timeout=120,
                input="",
            )
            if result.returncode != 0:
                stderr_msg = result.stderr.strip() or "unknown error"
                raise RuntimeError(
                    f"gemini CLI exited with code {result.returncode}: {stderr_msg}"
                )
            output = result.stdout.strip()
            if not output:
                raise RuntimeError("gemini CLI returned empty output.")
            return output
        except FileNotFoundError:
            raise RuntimeError(
                "gemini CLI not found. Install it and ensure it is on your PATH."
            )
        except subprocess.TimeoutExpired:
            raise RuntimeError("gemini CLI timed out after 120 seconds.")

    # --- Claude CLI ---
    if model_choice == "claude-cli":
        try:
            result = subprocess.run(
                ["claude", "-p", prompt],
                capture_output=True,
                text=True,
                timeout=120,
                input="",
            )
            if result.returncode != 0:
                stderr_msg = result.stderr.strip() or "unknown error"
                raise RuntimeError(
                    f"claude CLI exited with code {result.returncode}: {stderr_msg}"
                )
            output = result.stdout.strip()
            if not output:
                raise RuntimeError("claude CLI returned empty output.")
            return output
        except FileNotFoundError:
            raise RuntimeError(
                "claude CLI not found. Install it and ensure it is on your PATH."
            )
        except subprocess.TimeoutExpired:
            raise RuntimeError("claude CLI timed out after 120 seconds.")

    # --- Codex CLI ---
    if model_choice == "codex-cli":
        try:
            result = subprocess.run(
                ["codex", "-p", prompt],
                capture_output=True,
                text=True,
                timeout=120,
                input="",
            )
            if result.returncode != 0:
                stderr_msg = result.stderr.strip() or "unknown error"
                raise RuntimeError(
                    f"codex CLI exited with code {result.returncode}: {stderr_msg}"
                )
            output = result.stdout.strip()
            if not output:
                raise RuntimeError("codex CLI returned empty output.")
            return output
        except FileNotFoundError:
            raise RuntimeError(
                "codex CLI not found. Install it and ensure it is on your PATH."
            )
        except subprocess.TimeoutExpired:
            raise RuntimeError("codex CLI timed out after 120 seconds.")

    raise ValueError(
        f"Unsupported model_choice '{model_choice}'. "
        "Valid options: 'ollama', 'gemini-cli', 'claude-cli', 'codex-cli'."
    )


# ---------------------------------------------------------------------------
# LangGraph State
# ---------------------------------------------------------------------------

class SAState(TypedDict):
    messages: Annotated[list, add_messages]
    prd_draft: str
    is_ready_for_architecture: bool
    model_choice: str
    architecture_draft: str
    user_stories_draft: str


# ---------------------------------------------------------------------------
# SA Interaction Node
# ---------------------------------------------------------------------------

def sa_interaction_node(state: SAState) -> SAState:
    """
    System Analyst agent node.

    Builds a full conversation prompt (system + history) and dispatches it
    to the model selected in state["model_choice"].

    If a finalized PRD already exists (is_ready_for_architecture is True),
    the node runs in Amendment Mode: it injects the current PRD into the prompt
    so the agent knows it must produce an updated, complete PRD that merges
    original + new requirements.
    """
    model_choice = state.get("model_choice", "ollama")
    existing_prd = state.get("prd_draft", "")
    already_ready = state.get("is_ready_for_architecture", False)

    # Build a single string prompt that concatenates the system instructions
    # and the conversation history — works for all adapters.
    history_lines: list[str] = []
    for msg in state["messages"]:
        if isinstance(msg, HumanMessage):
            history_lines.append(f"User: {msg.content}")
        elif isinstance(msg, AIMessage):
            history_lines.append(f"SA Agent: {msg.content}")
        elif isinstance(msg, SystemMessage):
            pass  # handled separately below

    conversation_text = "\n".join(history_lines)

    full_prompt = build_sa_prompt(
        conversation_text=conversation_text,
        existing_prd=existing_prd,
        already_ready=already_ready,
    )

    try:
        response_text = model_adapter(model_choice, full_prompt)
    except (RuntimeError, ValueError) as exc:
        response_text = (
            f"[ModelAdapter Error] Unable to get a response from '{model_choice}': "
            f"{exc}\n\n"
            "Please check that the selected AI backend is installed and running, "
            "then try again."
        )

    prd_draft = state.get("prd_draft", "")
    is_ready = state.get("is_ready_for_architecture", False)

    if "[PRD_READY]" in response_text:
        is_ready = True
        prd_draft = response_text.replace("[PRD_READY]", "").rstrip()

    return {
        "messages": [AIMessage(content=response_text)],
        "prd_draft": prd_draft,
        "is_ready_for_architecture": is_ready,
        "model_choice": model_choice,
        "architecture_draft": state.get("architecture_draft", ""),
        "user_stories_draft": state.get("user_stories_draft", ""),
    }


# ---------------------------------------------------------------------------
# LangGraph setup
# ---------------------------------------------------------------------------

graph_builder = StateGraph(SAState)
graph_builder.add_node("sa_agent", sa_interaction_node)
graph_builder.set_entry_point("sa_agent")
graph_builder.add_edge("sa_agent", END)

graph = graph_builder.compile(checkpointer=memory)


# ---------------------------------------------------------------------------
# FastAPI
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Interactive AI Software Factory",
    description="HITL AI Software Factory — Dynamic Model Adapter (Ollama / Gemini CLI / Claude CLI / Codex CLI) with System Analyst Agent",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

VALID_MODEL_CHOICES = {"ollama", "gemini-cli", "claude-cli", "codex-cli"}


class ChatRequest(BaseModel):
    thread_id: str
    user_input: str
    model_choice: str = "ollama"


class ChatResponse(BaseModel):
    ai_response: str
    current_prd: str
    is_ready: bool
    model_used: str


@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    if not request.user_input.strip():
        raise HTTPException(status_code=400, detail="user_input cannot be empty.")
    if not request.thread_id.strip():
        raise HTTPException(status_code=400, detail="thread_id cannot be empty.")

    model_choice = request.model_choice.strip().lower()
    if model_choice not in VALID_MODEL_CHOICES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid model_choice '{model_choice}'. "
                f"Valid options: {sorted(VALID_MODEL_CHOICES)}"
            ),
        )

    config = {"configurable": {"thread_id": request.thread_id}}

    # Only supply fields that are new for this turn.
    # Omitting prd_draft, is_ready_for_architecture, architecture_draft, and
    # user_stories_draft preserves their values from the existing checkpoint
    # so the SA Agent can read — and build upon — previously accumulated state.
    input_state = {
        "messages": [HumanMessage(content=request.user_input)],
        "model_choice": model_choice,
    }

    try:
        result = graph.invoke(input_state, config=config)
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"LangGraph invocation failed: {exc}"
        )

    ai_messages = [m for m in result["messages"] if isinstance(m, AIMessage)]
    if not ai_messages:
        raise HTTPException(status_code=500, detail="No AI response was generated.")

    latest_response = ai_messages[-1].content

    return ChatResponse(
        ai_response=latest_response,
        current_prd=result.get("prd_draft", ""),
        is_ready=result.get("is_ready_for_architecture", False),
        model_used=model_choice,
    )


class ThreadMessage(BaseModel):
    role: str
    content: str


class ThreadStateResponse(BaseModel):
    messages: list[ThreadMessage]
    current_prd: str
    is_ready: bool
    architecture_draft: str
    user_stories_draft: str


@app.get("/api/chat/{thread_id}", response_model=ThreadStateResponse)
async def get_thread_state(thread_id: str):
    """Return the persisted conversation state for a given thread_id."""
    config = {"configurable": {"thread_id": thread_id}}
    try:
        state_snapshot = graph.get_state(config)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve thread state: {exc}",
        )

    # No checkpoint exists yet for this thread
    if state_snapshot is None or not state_snapshot.values:
        return ThreadStateResponse(
            messages=[], current_prd="", is_ready=False, architecture_draft="", user_stories_draft=""
        )

    values = state_snapshot.values
    raw_messages = values.get("messages", [])

    thread_messages: list[ThreadMessage] = []
    for msg in raw_messages:
        if isinstance(msg, HumanMessage):
            thread_messages.append(ThreadMessage(role="user", content=msg.content))
        elif isinstance(msg, AIMessage):
            thread_messages.append(ThreadMessage(role="assistant", content=msg.content))

    return ThreadStateResponse(
        messages=thread_messages,
        current_prd=values.get("prd_draft", ""),
        is_ready=values.get("is_ready_for_architecture", False),
        architecture_draft=values.get("architecture_draft", ""),
        user_stories_draft=values.get("user_stories_draft", ""),
    )


class DeleteThreadResponse(BaseModel):
    success: bool
    thread_id: str


@app.delete("/api/chat/{thread_id}", response_model=DeleteThreadResponse)
async def delete_thread(thread_id: str):
    """Delete all persisted checkpoint data for a given thread_id."""
    try:
        conn.execute(
            "DELETE FROM checkpoints WHERE thread_id = ?", (thread_id,)
        )
        conn.execute(
            "DELETE FROM checkpoint_writes WHERE thread_id = ?", (thread_id,)
        )
        conn.commit()
    except sqlite3.Error as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete thread '{thread_id}': {exc}",
        )
    return DeleteThreadResponse(success=True, thread_id=thread_id)


# ---------------------------------------------------------------------------
# Architecture generation endpoint
# ---------------------------------------------------------------------------

class GenerateArchitectureRequest(BaseModel):
    thread_id: str
    model_choice: str = "ollama"


class GenerateArchitectureResponse(BaseModel):
    architecture_draft: str


@app.post("/api/generate_architecture", response_model=GenerateArchitectureResponse)
async def generate_architecture(request: GenerateArchitectureRequest):
    """
    Human-in-the-Loop gate: user approves the PRD, then this endpoint invokes
    the Architect Agent to produce a technical design with Mermaid diagrams.
    """
    model_choice = request.model_choice.strip().lower()
    if model_choice not in VALID_MODEL_CHOICES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid model_choice '{model_choice}'. "
                f"Valid options: {sorted(VALID_MODEL_CHOICES)}"
            ),
        )

    config = {"configurable": {"thread_id": request.thread_id}}

    # Retrieve current state
    try:
        state_snapshot = graph.get_state(config)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve thread state: {exc}",
        )

    if state_snapshot is None or not state_snapshot.values:
        raise HTTPException(status_code=400, detail="PRD is not ready yet.")

    prd_draft = state_snapshot.values.get("prd_draft", "").strip()
    if not prd_draft:
        raise HTTPException(status_code=400, detail="PRD is not ready yet.")

    architect_prompt = build_architect_prompt(prd_draft)

    # Invoke the model (runs in a thread to avoid blocking the event loop)
    try:
        result = await asyncio.to_thread(model_adapter, model_choice, architect_prompt)
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Architect agent failed: {exc}",
        )

    # Persist the architecture draft back into the graph state
    try:
        graph.update_state(config, {"architecture_draft": result})
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to persist architecture draft: {exc}",
        )

    return GenerateArchitectureResponse(architecture_draft=result)


# ---------------------------------------------------------------------------
# Architecture edit endpoint
# ---------------------------------------------------------------------------

class UpdateArchitectureRequest(BaseModel):
    content: str


class UpdateArchitectureResponse(BaseModel):
    success: bool
    architecture_draft: str


@app.put("/api/architecture/{thread_id}", response_model=UpdateArchitectureResponse)
async def update_architecture(thread_id: str, request: UpdateArchitectureRequest):
    """
    Persist a manually-edited architecture draft.
    Also clears user_stories_draft since it would be stale after an architecture edit.
    """
    config = {"configurable": {"thread_id": thread_id}}
    try:
        graph.update_state(
            config,
            {
                "architecture_draft": request.content,
                "user_stories_draft": "",
            },
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to persist architecture for thread '{thread_id}': {exc}",
        )
    return UpdateArchitectureResponse(success=True, architecture_draft=request.content)


# ---------------------------------------------------------------------------
# User Stories generation endpoint
# ---------------------------------------------------------------------------

class GenerateUserStoriesRequest(BaseModel):
    thread_id: str
    model_choice: str = "ollama"


class GenerateUserStoriesResponse(BaseModel):
    user_stories_draft: str


@app.post("/api/generate_user_stories", response_model=GenerateUserStoriesResponse)
async def generate_user_stories(request: GenerateUserStoriesRequest):
    """
    Human-in-the-Loop gate: user approves the architecture, then this endpoint
    invokes the User Story Agent to produce epics and user stories with
    acceptance criteria and story points.
    """
    model_choice = request.model_choice.strip().lower()
    if model_choice not in VALID_MODEL_CHOICES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid model_choice '{model_choice}'. "
                f"Valid options: {sorted(VALID_MODEL_CHOICES)}"
            ),
        )

    config = {"configurable": {"thread_id": request.thread_id}}

    # Retrieve current state
    try:
        state_snapshot = graph.get_state(config)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve thread state: {exc}",
        )

    if state_snapshot is None or not state_snapshot.values:
        raise HTTPException(status_code=400, detail="Architecture is not ready yet.")

    architecture_draft = state_snapshot.values.get("architecture_draft", "").strip()
    if not architecture_draft:
        raise HTTPException(
            status_code=400,
            detail="Architecture must be generated before creating user stories.",
        )

    prd_draft = state_snapshot.values.get("prd_draft", "").strip()

    user_stories_prompt = build_user_stories_prompt(
        prd_draft=prd_draft,
        architecture_draft=architecture_draft,
    )

    # Invoke the model in a thread to avoid blocking the event loop
    try:
        result = await asyncio.to_thread(model_adapter, model_choice, user_stories_prompt)
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(
            status_code=500,
            detail=f"User Story agent failed: {exc}",
        )

    # Persist the user stories draft back into the graph state
    try:
        graph.update_state(config, {"user_stories_draft": result})
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to persist user stories draft: {exc}",
        )

    return GenerateUserStoriesResponse(user_stories_draft=result)


# ---------------------------------------------------------------------------
# Jira push endpoint
# ---------------------------------------------------------------------------

class PushToJiraRequest(BaseModel):
    thread_id: str
    model_choice: str = "ollama"
    jira_domain: str
    jira_email: str
    jira_token: str
    jira_project_key: str


class PushToJiraResponse(BaseModel):
    success: bool
    created_issues: list[str]
    count: int


@app.post("/api/push_to_jira", response_model=PushToJiraResponse)
async def push_to_jira(request: PushToJiraRequest):
    """
    Parse user stories into structured JSON via the AI model, then create
    Jira issues for each story using the Jira REST API v3.
    """
    model_choice = request.model_choice.strip().lower()
    if model_choice not in VALID_MODEL_CHOICES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid model_choice '{model_choice}'. "
                f"Valid options: {sorted(VALID_MODEL_CHOICES)}"
            ),
        )

    config = {"configurable": {"thread_id": request.thread_id}}

    # Retrieve current state
    try:
        state_snapshot = graph.get_state(config)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve thread state: {exc}",
        )

    if state_snapshot is None or not state_snapshot.values:
        raise HTTPException(status_code=400, detail="User stories are not ready yet.")

    user_stories_draft = state_snapshot.values.get("user_stories_draft", "").strip()
    if not user_stories_draft:
        raise HTTPException(
            status_code=400,
            detail="User stories must be generated before pushing to Jira.",
        )

    parse_prompt = build_story_parse_prompt(user_stories_draft)

    try:
        raw_json = await asyncio.to_thread(model_adapter, model_choice, parse_prompt)
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Model failed to parse user stories: {exc}",
        )

    # Strip any accidental markdown code fences the model may have added
    raw_json = raw_json.strip()
    if raw_json.startswith("```"):
        lines = raw_json.splitlines()
        raw_json = "\n".join(
            line for line in lines if not line.strip().startswith("```")
        ).strip()

    try:
        stories: list[dict] = json_lib.loads(raw_json)
        if not isinstance(stories, list):
            raise ValueError("Expected a JSON array at the top level.")
    except (json_lib.JSONDecodeError, ValueError) as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Could not parse model output as JSON: {exc}. Raw output: {raw_json[:500]}",
        )

    # Step 2: Create Jira issues
    auth = base64.b64encode(
        f"{request.jira_email}:{request.jira_token}".encode()
    ).decode()
    headers = {
        "Authorization": f"Basic {auth}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    jira_url = f"https://{request.jira_domain}/rest/api/3/issue"

    created_keys: list[str] = []

    for story in stories:
        summary = str(story.get("summary", "Untitled Story"))[:80]
        base_description = str(story.get("description", summary))
        story_points = story.get("story_points", 3)
        if not isinstance(story_points, int):
            try:
                story_points = int(story_points)
            except (TypeError, ValueError):
                story_points = 3
        description_text = f"{base_description}\n\n**[ Story Points: {story_points} ]**"

        payload = {
            "fields": {
                "project": {"key": request.jira_project_key},
                "summary": summary,
                "description": {
                    "type": "doc",
                    "version": 1,
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [{"type": "text", "text": description_text}],
                        }
                    ],
                },
                "issuetype": {"name": "Story"},
            }
        }

        req = urllib.request.Request(
            jira_url,
            data=json_lib.dumps(payload).encode(),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                result_data = json_lib.loads(resp.read())
                created_keys.append(result_data["key"])
        except urllib.error.HTTPError as exc:
            error_body = exc.read().decode("utf-8", errors="replace")
            raise HTTPException(
                status_code=502,
                detail=f"Jira API error (HTTP {exc.code}): {error_body}",
            )
        except urllib.error.URLError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Could not reach Jira at '{request.jira_domain}': {exc.reason}",
            )

    return PushToJiraResponse(
        success=True,
        created_issues=created_keys,
        count=len(created_keys),
    )


# ---------------------------------------------------------------------------
# Jira projects list endpoint
# ---------------------------------------------------------------------------

class JiraProject(BaseModel):
    key: str
    name: str
    id: str


class JiraProjectsResponse(BaseModel):
    projects: list[JiraProject]


@app.get("/api/jira/projects", response_model=JiraProjectsResponse)
async def get_jira_projects(domain: str, email: str, token: str):
    """
    Fetch all accessible Jira projects for the given credentials.
    Returns HTTP 401 on auth failure, HTTP 502 on network/other errors.
    """
    auth = base64.b64encode(f"{email}:{token}".encode()).decode()
    url = f"https://{domain}/rest/api/3/project"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Basic {auth}",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            projects = json_lib.loads(resp.read())
            return JiraProjectsResponse(
                projects=[
                    JiraProject(key=p["key"], name=p["name"], id=str(p["id"]))
                    for p in projects
                ]
            )
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise HTTPException(status_code=401, detail="Invalid Jira credentials")
        raise HTTPException(status_code=502, detail=f"Jira error: {exc.reason}")
    except urllib.error.URLError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not reach Jira at '{domain}': {exc.reason}",
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


# ---------------------------------------------------------------------------
# PRD reset endpoint
# ---------------------------------------------------------------------------

class ResetPrdResponse(BaseModel):
    success: bool


@app.post("/api/reset_prd/{thread_id}", response_model=ResetPrdResponse)
async def reset_prd(thread_id: str):
    """
    Reset PRD and architecture state so the user can re-enter the clarification phase.
    Conversation history is preserved.
    """
    config = {"configurable": {"thread_id": thread_id}}
    try:
        graph.update_state(
            config,
            {
                "prd_draft": "",
                "is_ready_for_architecture": False,
                "architecture_draft": "",
                "user_stories_draft": "",
            },
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to reset PRD for thread '{thread_id}': {exc}",
        )
    return ResetPrdResponse(success=True)


# ---------------------------------------------------------------------------
# Export endpoint
# ---------------------------------------------------------------------------

@app.get("/api/export/{thread_id}")
async def export_project(thread_id: str):
    """
    Export the full project document (PRD + Architecture) as a downloadable Markdown file.
    Returns HTTP 400 if both sections are empty.
    """
    config = {"configurable": {"thread_id": thread_id}}
    try:
        state_snapshot = graph.get_state(config)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve thread state: {exc}",
        )

    values = state_snapshot.values if (state_snapshot and state_snapshot.values) else {}
    prd_draft = values.get("prd_draft", "").strip()
    architecture_draft = values.get("architecture_draft", "").strip()
    user_stories_draft = values.get("user_stories_draft", "").strip()

    if not prd_draft and not architecture_draft and not user_stories_draft:
        raise HTTPException(
            status_code=400,
            detail="Nothing to export — PRD, architecture, and user stories are all empty.",
        )

    sections: list[str] = [f"# Project: {thread_id}\n"]

    if prd_draft:
        sections.append("## Product Requirements Document\n")
        sections.append(prd_draft)

    if prd_draft and architecture_draft:
        sections.append("\n---\n")

    if architecture_draft:
        sections.append("## System Architecture\n")
        sections.append(architecture_draft)

    if (prd_draft or architecture_draft) and user_stories_draft:
        sections.append("\n---\n")

    if user_stories_draft:
        sections.append("## User Stories\n")
        sections.append(user_stories_draft)

    markdown_content = "\n".join(sections)

    return Response(
        content=markdown_content,
        media_type="text/markdown",
        headers={
            "Content-Disposition": f'attachment; filename="{thread_id}-project.md"'
        },
    )


# ---------------------------------------------------------------------------
# Model availability check
# ---------------------------------------------------------------------------

class ModelsCheckResponse(BaseModel):
    available: list[str]


def _check_ollama() -> bool:
    """Return True if Ollama is running and reachable."""
    try:
        req = urllib.request.urlopen(
            f"{OLLAMA_BASE_URL}/api/tags", timeout=3
        )
        return req.status == 200
    except Exception:
        return False


def _check_cli(cmd: str) -> bool:
    """Return True if the given CLI tool exists and --version exits cleanly."""
    try:
        result = subprocess.run(
            [cmd, "--version"],
            capture_output=True,
            timeout=3,
            input=b"",
        )
        return result.returncode == 0
    except Exception:
        return False


@app.get("/api/models/check", response_model=ModelsCheckResponse)
async def check_models():
    """
    Probe each supported AI backend and return which ones are reachable.
    Checks run concurrently to minimise latency.
    """
    ollama_ok, gemini_ok, claude_ok, codex_ok = await asyncio.gather(
        asyncio.to_thread(_check_ollama),
        asyncio.to_thread(_check_cli, "gemini"),
        asyncio.to_thread(_check_cli, "claude"),
        asyncio.to_thread(_check_cli, "codex"),
    )

    available: list[str] = []
    if ollama_ok:
        available.append("ollama")
    if gemini_ok:
        available.append("gemini-cli")
    if claude_ok:
        available.append("claude-cli")
    if codex_ok:
        available.append("codex-cli")

    return ModelsCheckResponse(available=available)


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "version": "2.0.0",
        "supported_models": sorted(VALID_MODEL_CHOICES),
    }


# ---------------------------------------------------------------------------
# File upload helpers
# ---------------------------------------------------------------------------

SUPPORTED_EXTENSIONS = {".xlsx", ".xls", ".docx", ".pdf", ".md"}


def _extract_excel(data: bytes) -> str:
    """Convert all sheets of an Excel workbook to plain-text tables."""
    wb = openpyxl.load_workbook(filename=io.BytesIO(data), read_only=True, data_only=True)
    parts: list[str] = []
    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        parts.append(f"## Sheet: {sheet_name}")
        for row in ws.iter_rows(values_only=True):
            cells = [str(c) if c is not None else "" for c in row]
            parts.append("\t".join(cells))
    wb.close()
    return "\n".join(parts)


def _extract_docx(data: bytes) -> str:
    """Extract paragraphs and table cells from a Word document."""
    doc = DocxDocument(io.BytesIO(data))
    parts: list[str] = []

    for para in doc.paragraphs:
        text = para.text.strip()
        if text:
            parts.append(text)

    for table in doc.tables:
        parts.append("")
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells]
            parts.append("\t".join(cells))

    return "\n".join(parts)


def _extract_pdf(data: bytes) -> str:
    """Extract text from every page of a PDF using PyMuPDF."""
    parts: list[str] = []
    with fitz.open(stream=data, filetype="pdf") as doc:
        for page_num, page in enumerate(doc, start=1):
            text = page.get_text().strip()
            if text:
                parts.append(f"## Page {page_num}\n{text}")
    return "\n\n".join(parts)


def _extract_markdown(data: bytes) -> str:
    """Read a Markdown file as UTF-8 text."""
    return data.decode("utf-8", errors="replace")


# ---------------------------------------------------------------------------
# /api/upload endpoint
# ---------------------------------------------------------------------------

class UploadResponse(BaseModel):
    filename: str
    content: str


@app.post("/api/upload", response_model=UploadResponse)
async def upload_file(file: UploadFile = File(...)):
    filename = file.filename or "unknown"
    ext = ""
    if "." in filename:
        ext = "." + filename.rsplit(".", 1)[-1].lower()

    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail=(
                f"Unsupported file type '{ext}'. "
                f"Supported: {sorted(SUPPORTED_EXTENSIONS)}"
            ),
        )

    try:
        raw = await file.read()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to read uploaded file: {exc}")

    try:
        if ext in {".xlsx", ".xls"}:
            content = _extract_excel(raw)
        elif ext == ".docx":
            content = _extract_docx(raw)
        elif ext == ".pdf":
            content = _extract_pdf(raw)
        elif ext == ".md":
            content = _extract_markdown(raw)
        else:
            # Should never reach here due to the extension check above
            raise HTTPException(status_code=415, detail="Unsupported file type.")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Failed to parse '{filename}': {exc}",
        )

    if not content.strip():
        raise HTTPException(
            status_code=422,
            detail=f"No text content could be extracted from '{filename}'.",
        )

    return UploadResponse(filename=filename, content=content)
