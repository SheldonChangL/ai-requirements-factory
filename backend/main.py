import asyncio
import io
import os
import sqlite3
import urllib.error
from typing import Annotated, Optional, TypedDict

import fitz  # PyMuPDF
import openpyxl
from docx import Document as DocxDocument
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, StateGraph
from langgraph.graph.message import add_messages
from pydantic import BaseModel

try:
    from api_errors import error_detail
    from artifacts import (
        ProjectArtifacts,
        delivery_items_to_json,
        export_project_json,
        export_project_markdown,
    )
    from integrations.jira import list_jira_projects
    from integrations.github import list_github_repos
    from integrations.registry_map import DELIVERY_INTEGRATIONS
    from model_adapters import MODEL_ADAPTERS, get_supported_model_choices, invoke_model
    from prompts import (
        build_arch_chat_prompt,
        build_architecture_refine_prompt,
        build_architect_prompt,
        build_prd_refine_prompt,
        build_sa_prompt,
        build_stories_chat_prompt,
        build_user_stories_refine_prompt,
        build_user_stories_prompt,
    )
    from workflow import parse_delivery_items, project_artifacts_from_state
except ModuleNotFoundError:
    from backend.api_errors import error_detail
    from backend.artifacts import (
        ProjectArtifacts,
        delivery_items_to_json,
        export_project_json,
        export_project_markdown,
    )
    from backend.integrations.jira import list_jira_projects
    from backend.integrations.github import list_github_repos
    from backend.integrations.registry_map import DELIVERY_INTEGRATIONS
    from backend.model_adapters import MODEL_ADAPTERS, get_supported_model_choices, invoke_model
    from backend.prompts import (
        build_arch_chat_prompt,
        build_architecture_refine_prompt,
        build_architect_prompt,
        build_prd_refine_prompt,
        build_sa_prompt,
        build_stories_chat_prompt,
        build_user_stories_refine_prompt,
        build_user_stories_prompt,
    )
    from backend.workflow import parse_delivery_items, project_artifacts_from_state

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
# Stage chat — SQLite-backed message store
# ---------------------------------------------------------------------------

CONTENT_START_MARKER = "[CONTENT_START]"
CONTENT_END_MARKER   = "[CONTENT_END]"

conn.execute("""
    CREATE TABLE IF NOT EXISTS stage_messages (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id  TEXT    NOT NULL,
        stage      TEXT    NOT NULL,
        role       TEXT    NOT NULL,
        content    TEXT    NOT NULL,
        created_at REAL    NOT NULL DEFAULT (strftime('%s','now'))
    )
""")
conn.execute(
    "CREATE INDEX IF NOT EXISTS idx_stage_messages ON stage_messages (thread_id, stage, id)"
)
conn.commit()


def _load_stage_messages(thread_id: str, stage: str) -> list[dict]:
    rows = conn.execute(
        "SELECT role, content FROM stage_messages WHERE thread_id=? AND stage=? ORDER BY id",
        (thread_id, stage),
    ).fetchall()
    return [{"role": row[0], "content": row[1]} for row in rows]


def _append_stage_message(thread_id: str, stage: str, role: str, content: str) -> None:
    conn.execute(
        "INSERT INTO stage_messages (thread_id, stage, role, content) VALUES (?, ?, ?, ?)",
        (thread_id, stage, role, content),
    )
    conn.commit()


def _delete_stage_messages(thread_id: str) -> None:
    conn.execute("DELETE FROM stage_messages WHERE thread_id=?", (thread_id,))
    conn.commit()


def _extract_stage_content(response_text: str) -> "tuple[str, Optional[str]]":
    """
    Split agent response into (conversational_part, updated_artifact | None).

    If the agent wrapped updated content in [CONTENT_START]…[CONTENT_END],
    the text before the marker becomes the chat message and the content inside
    becomes the updated artifact.  Otherwise the full text is the chat message.
    """
    start = response_text.find(CONTENT_START_MARKER)
    end   = response_text.find(CONTENT_END_MARKER)
    if start != -1 and end != -1 and end > start:
        conversation_part = response_text[:start].strip()
        content_part      = response_text[start + len(CONTENT_START_MARKER):end].strip()
        return conversation_part or "I've updated the content as requested.", content_part
    return response_text, None


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
        response_text = invoke_model(model_choice, full_prompt)
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

VALID_MODEL_CHOICES = set(get_supported_model_choices())
VALID_DELIVERY_TARGETS = set(DELIVERY_INTEGRATIONS.keys())


def validate_model_choice(model_choice: str) -> str:
    normalized = model_choice.strip().lower()
    if normalized not in VALID_MODEL_CHOICES:
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "invalid_model_choice",
                f"Invalid model_choice '{normalized}'. "
                f"Valid options: {sorted(VALID_MODEL_CHOICES)}",
            ),
        )
    return normalized


def validate_delivery_target(target: str) -> str:
    normalized = target.strip().lower()
    if normalized not in VALID_DELIVERY_TARGETS:
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "invalid_delivery_target",
                f"Invalid delivery target '{normalized}'. "
                f"Valid options: {sorted(VALID_DELIVERY_TARGETS)}",
            ),
        )
    return normalized


def get_thread_values(thread_id: str) -> dict:
    config = {"configurable": {"thread_id": thread_id}}
    try:
        state_snapshot = graph.get_state(config)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=error_detail("state_error", f"Failed to retrieve thread state: {exc}"),
        ) from exc

    if state_snapshot is None or not state_snapshot.values:
        return {}
    return state_snapshot.values


def get_project_artifacts(thread_id: str) -> ProjectArtifacts:
    return project_artifacts_from_state(thread_id, get_thread_values(thread_id))


def require_user_stories(thread_id: str) -> str:
    artifacts = get_project_artifacts(thread_id)
    if not artifacts.user_stories:
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "missing_user_stories",
                "User stories must be generated before using delivery integrations.",
            ),
        )
    return artifacts.user_stories


def require_prd(thread_id: str) -> str:
    artifacts = get_project_artifacts(thread_id)
    if not artifacts.prd:
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "missing_prd",
                "PRD must exist before this stage can be updated.",
            ),
        )
    return artifacts.prd


def require_architecture(thread_id: str) -> str:
    artifacts = get_project_artifacts(thread_id)
    if not artifacts.architecture:
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "missing_architecture",
                "Architecture must exist before this stage can be updated.",
            ),
        )
    return artifacts.architecture


def parse_delivery_items_or_raise(thread_id: str, model_choice: str):
    user_stories_draft = require_user_stories(thread_id)
    try:
        return parse_delivery_items(user_stories_draft, model_choice)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail=error_detail(
                "story_parse_error",
                f"Could not parse model output as JSON: {exc}",
            ),
        ) from exc
    except (RuntimeError, FileNotFoundError) as exc:
        raise HTTPException(
            status_code=500,
            detail=error_detail("model_error", f"Model failed to parse user stories: {exc}"),
        ) from exc


def build_delivery_config(
    target: str,
    *,
    require_credentials: bool = True,
    jira_domain: str = "",
    jira_email: str = "",
    jira_token: str = "",
    jira_project_key: str = "",
    github_owner: str = "",
    github_repo: str = "",
    github_token: str = "",
) -> dict[str, str]:
    if target == "jira":
        if not jira_project_key.strip():
            raise HTTPException(
                status_code=400,
                detail=error_detail(
                    "invalid_integration_config",
                    "Jira delivery requires a project key.",
                ),
            )
        if require_credentials and not all([jira_domain.strip(), jira_email.strip(), jira_token.strip()]):
            raise HTTPException(
                status_code=400,
                detail=error_detail(
                    "invalid_integration_config",
                    "Jira publish requires domain, email, and API token.",
                ),
            )
        return {
            "domain": jira_domain.strip(),
            "email": jira_email.strip(),
            "token": jira_token.strip(),
            "project_key": jira_project_key.strip(),
        }

    if target == "github":
        if not all([github_owner.strip(), github_repo.strip()]):
            raise HTTPException(
                status_code=400,
                detail=error_detail(
                    "invalid_integration_config",
                    "GitHub delivery requires owner and repo.",
                ),
            )
        if require_credentials and not github_token.strip():
            raise HTTPException(
                status_code=400,
                detail=error_detail(
                    "invalid_integration_config",
                    "GitHub publish requires a personal access token.",
                ),
            )
        return {
            "owner": github_owner.strip(),
            "repo": github_repo.strip(),
            "token": github_token.strip(),
        }

    raise HTTPException(
        status_code=400,
        detail=error_detail("invalid_delivery_target", f"Unsupported target '{target}'."),
    )


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
        raise HTTPException(
            status_code=400,
            detail=error_detail("invalid_input", "user_input cannot be empty."),
        )
    if not request.thread_id.strip():
        raise HTTPException(
            status_code=400,
            detail=error_detail("invalid_input", "thread_id cannot be empty."),
        )

    model_choice = request.model_choice.strip().lower()
    if model_choice not in VALID_MODEL_CHOICES:
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "invalid_model_choice",
                f"Invalid model_choice '{model_choice}'. "
                f"Valid options: {sorted(VALID_MODEL_CHOICES)}",
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
            status_code=500,
            detail=error_detail("workflow_error", f"LangGraph invocation failed: {exc}"),
        )

    ai_messages = [m for m in result["messages"] if isinstance(m, AIMessage)]
    if not ai_messages:
        raise HTTPException(
            status_code=500,
            detail=error_detail("model_error", "No AI response was generated."),
        )

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
            detail=error_detail("state_error", f"Failed to retrieve thread state: {exc}"),
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


class UpdatePrdRequest(BaseModel):
    content: str


class UpdatePrdResponse(BaseModel):
    success: bool
    prd_draft: str
    is_ready: bool


@app.put("/api/prd/{thread_id}", response_model=UpdatePrdResponse)
async def update_prd(thread_id: str, request: UpdatePrdRequest):
    content = request.content.strip()
    if not content:
        raise HTTPException(
            status_code=400,
            detail=error_detail("invalid_input", "PRD content cannot be empty."),
        )

    config = {"configurable": {"thread_id": thread_id}}
    try:
        graph.update_state(
            config,
            {
                "prd_draft": content,
                "is_ready_for_architecture": True,
                "architecture_draft": "",
                "user_stories_draft": "",
            },
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=error_detail(
                "state_error",
                f"Failed to persist PRD for thread '{thread_id}': {exc}",
            ),
        )
    return UpdatePrdResponse(success=True, prd_draft=content, is_ready=True)


class RefinePrdRequest(BaseModel):
    thread_id: str
    model_choice: str = "ollama"
    instruction: str


class RefinePrdResponse(BaseModel):
    prd_draft: str
    is_ready: bool


@app.post("/api/refine_prd", response_model=RefinePrdResponse)
async def refine_prd(request: RefinePrdRequest):
    if not request.instruction.strip():
        raise HTTPException(
            status_code=400,
            detail=error_detail("invalid_input", "instruction cannot be empty."),
        )

    model_choice = validate_model_choice(request.model_choice)
    existing_prd = require_prd(request.thread_id)
    prompt = build_prd_refine_prompt(existing_prd, request.instruction.strip())

    try:
        result = await asyncio.to_thread(invoke_model, model_choice, prompt)
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(
            status_code=500,
            detail=error_detail("model_error", f"PRD refine failed: {exc}"),
        )

    updated_prd = result.replace("[PRD_READY]", "").rstrip()
    config = {"configurable": {"thread_id": request.thread_id}}
    try:
        graph.update_state(
            config,
            {
                "prd_draft": updated_prd,
                "is_ready_for_architecture": True,
                "architecture_draft": "",
                "user_stories_draft": "",
            },
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=error_detail("state_error", f"Failed to persist refined PRD: {exc}"),
        )

    return RefinePrdResponse(prd_draft=updated_prd, is_ready=True)


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
        _delete_stage_messages(thread_id)
        conn.commit()
    except sqlite3.Error as exc:
        raise HTTPException(
            status_code=500,
            detail=error_detail("state_error", f"Failed to delete thread '{thread_id}': {exc}"),
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
            detail=error_detail(
                "invalid_model_choice",
                f"Invalid model_choice '{model_choice}'. "
                f"Valid options: {sorted(VALID_MODEL_CHOICES)}",
            ),
        )

    config = {"configurable": {"thread_id": request.thread_id}}

    # Retrieve current state
    try:
        state_snapshot = graph.get_state(config)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=error_detail("state_error", f"Failed to retrieve thread state: {exc}"),
        )

    if state_snapshot is None or not state_snapshot.values:
        raise HTTPException(
            status_code=400,
            detail=error_detail("missing_prd", "PRD is not ready yet."),
        )

    prd_draft = state_snapshot.values.get("prd_draft", "").strip()
    if not prd_draft:
        raise HTTPException(
            status_code=400,
            detail=error_detail("missing_prd", "PRD is not ready yet."),
        )

    architect_prompt = build_architect_prompt(prd_draft)

    # Invoke the model (runs in a thread to avoid blocking the event loop)
    try:
        result = await asyncio.to_thread(invoke_model, model_choice, architect_prompt)
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(
            status_code=500,
            detail=error_detail("model_error", f"Architect agent failed: {exc}"),
        )

    # Persist the architecture draft back into the graph state
    try:
        graph.update_state(config, {"architecture_draft": result})
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=error_detail("state_error", f"Failed to persist architecture draft: {exc}"),
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
            detail=error_detail(
                "state_error",
                f"Failed to persist architecture for thread '{thread_id}': {exc}",
            ),
        )
    return UpdateArchitectureResponse(success=True, architecture_draft=request.content)


class RefineArchitectureRequest(BaseModel):
    thread_id: str
    model_choice: str = "ollama"
    instruction: str


class RefineArchitectureResponse(BaseModel):
    architecture_draft: str


@app.post("/api/refine_architecture", response_model=RefineArchitectureResponse)
async def refine_architecture(request: RefineArchitectureRequest):
    if not request.instruction.strip():
        raise HTTPException(
            status_code=400,
            detail=error_detail("invalid_input", "instruction cannot be empty."),
        )

    model_choice = validate_model_choice(request.model_choice)
    prd_draft = require_prd(request.thread_id)
    architecture_draft = require_architecture(request.thread_id)
    prompt = build_architecture_refine_prompt(
        prd_draft,
        architecture_draft,
        request.instruction.strip(),
    )

    try:
        result = await asyncio.to_thread(invoke_model, model_choice, prompt)
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(
            status_code=500,
            detail=error_detail("model_error", f"Architecture refine failed: {exc}"),
        )

    config = {"configurable": {"thread_id": request.thread_id}}
    try:
        graph.update_state(
            config,
            {
                "architecture_draft": result,
                "user_stories_draft": "",
            },
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=error_detail("state_error", f"Failed to persist refined architecture: {exc}"),
        )

    return RefineArchitectureResponse(architecture_draft=result)


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
            detail=error_detail(
                "invalid_model_choice",
                f"Invalid model_choice '{model_choice}'. "
                f"Valid options: {sorted(VALID_MODEL_CHOICES)}",
            ),
        )

    config = {"configurable": {"thread_id": request.thread_id}}

    # Retrieve current state
    try:
        state_snapshot = graph.get_state(config)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=error_detail("state_error", f"Failed to retrieve thread state: {exc}"),
        )

    if state_snapshot is None or not state_snapshot.values:
        raise HTTPException(
            status_code=400,
            detail=error_detail("missing_architecture", "Architecture is not ready yet."),
        )

    architecture_draft = state_snapshot.values.get("architecture_draft", "").strip()
    if not architecture_draft:
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "missing_architecture",
                "Architecture must be generated before creating user stories.",
            ),
        )

    prd_draft = state_snapshot.values.get("prd_draft", "").strip()

    user_stories_prompt = build_user_stories_prompt(
        prd_draft=prd_draft,
        architecture_draft=architecture_draft,
    )

    # Invoke the model in a thread to avoid blocking the event loop
    try:
        result = await asyncio.to_thread(invoke_model, model_choice, user_stories_prompt)
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(
            status_code=500,
            detail=error_detail("model_error", f"User Story agent failed: {exc}"),
        )

    # Persist the user stories draft back into the graph state
    try:
        graph.update_state(config, {"user_stories_draft": result})
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=error_detail("state_error", f"Failed to persist user stories draft: {exc}"),
        )

    return GenerateUserStoriesResponse(user_stories_draft=result)


class UpdateUserStoriesRequest(BaseModel):
    content: str


class UpdateUserStoriesResponse(BaseModel):
    success: bool
    user_stories_draft: str


@app.put("/api/user_stories/{thread_id}", response_model=UpdateUserStoriesResponse)
async def update_user_stories(thread_id: str, request: UpdateUserStoriesRequest):
    content = request.content.strip()
    if not content:
        raise HTTPException(
            status_code=400,
            detail=error_detail("invalid_input", "User stories content cannot be empty."),
        )

    config = {"configurable": {"thread_id": thread_id}}
    try:
        graph.update_state(config, {"user_stories_draft": content})
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=error_detail(
                "state_error",
                f"Failed to persist user stories for thread '{thread_id}': {exc}",
            ),
        )
    return UpdateUserStoriesResponse(success=True, user_stories_draft=content)


class RefineUserStoriesRequest(BaseModel):
    thread_id: str
    model_choice: str = "ollama"
    instruction: str


class RefineUserStoriesResponse(BaseModel):
    user_stories_draft: str


@app.post("/api/refine_user_stories", response_model=RefineUserStoriesResponse)
async def refine_user_stories(request: RefineUserStoriesRequest):
    if not request.instruction.strip():
        raise HTTPException(
            status_code=400,
            detail=error_detail("invalid_input", "instruction cannot be empty."),
        )

    model_choice = validate_model_choice(request.model_choice)
    prd_draft = require_prd(request.thread_id)
    architecture_draft = require_architecture(request.thread_id)
    user_stories_draft = require_user_stories(request.thread_id)
    prompt = build_user_stories_refine_prompt(
        prd_draft,
        architecture_draft,
        user_stories_draft,
        request.instruction.strip(),
    )

    try:
        result = await asyncio.to_thread(invoke_model, model_choice, prompt)
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(
            status_code=500,
            detail=error_detail("model_error", f"User stories refine failed: {exc}"),
        )

    config = {"configurable": {"thread_id": request.thread_id}}
    try:
        graph.update_state(config, {"user_stories_draft": result})
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=error_detail("state_error", f"Failed to persist refined user stories: {exc}"),
        )

    return RefineUserStoriesResponse(user_stories_draft=result)


# ---------------------------------------------------------------------------
# Stage chat endpoints
# ---------------------------------------------------------------------------

VALID_STAGES = {"architecture", "stories"}


class StageChatRequest(BaseModel):
    thread_id: str
    user_input: str
    model_choice: str = "ollama"


class StageChatResponse(BaseModel):
    ai_response: str
    updated_content: Optional[str] = None


class StageHistoryMessage(BaseModel):
    role: str
    content: str


class StageHistoryResponse(BaseModel):
    messages: list[StageHistoryMessage]


@app.post("/api/stage/{stage}/chat", response_model=StageChatResponse)
async def stage_chat(stage: str, request: StageChatRequest):
    """
    Send a message to the stage-specific discussion agent.

    Each stage (architecture / stories) maintains its own conversation
    history, separate from the main PRD chat.  The agent has full context
    of the current PRD and relevant artifacts injected into every prompt.

    If the agent produces updated artifact content it wraps it in
    [CONTENT_START]…[CONTENT_END].  The endpoint parses this, persists the
    updated artifact back to the main thread state, and returns both the
    conversational message and the new content to the frontend.
    """
    if stage not in VALID_STAGES:
        raise HTTPException(
            status_code=400,
            detail=error_detail("invalid_stage", f"Stage must be one of: {sorted(VALID_STAGES)}"),
        )
    if not request.user_input.strip():
        raise HTTPException(
            status_code=400,
            detail=error_detail("invalid_input", "user_input cannot be empty."),
        )

    model_choice = validate_model_choice(request.model_choice)
    values = get_thread_values(request.thread_id)
    prd_draft           = str(values.get("prd_draft", "")).strip()
    architecture_draft  = str(values.get("architecture_draft", "")).strip()
    user_stories_draft  = str(values.get("user_stories_draft", "")).strip()

    # Build conversation text from persisted history
    history = _load_stage_messages(request.thread_id, stage)
    _append_stage_message(request.thread_id, stage, "user", request.user_input.strip())
    history.append({"role": "user", "content": request.user_input.strip()})

    conversation_text = "\n".join(
        f"{'User' if m['role'] == 'user' else 'Assistant'}: {m['content']}"
        for m in history
    )

    if stage == "architecture":
        prompt = build_arch_chat_prompt(
            prd_draft=prd_draft,
            architecture_draft=architecture_draft,
            conversation_text=conversation_text,
        )
    else:
        prompt = build_stories_chat_prompt(
            prd_draft=prd_draft,
            architecture_draft=architecture_draft,
            user_stories_draft=user_stories_draft,
            conversation_text=conversation_text,
        )

    try:
        raw_response = await asyncio.to_thread(invoke_model, model_choice, prompt)
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(
            status_code=500,
            detail=error_detail("model_error", f"Stage agent failed: {exc}"),
        )

    ai_message, updated_content = _extract_stage_content(raw_response)
    _append_stage_message(request.thread_id, stage, "assistant", ai_message)

    # Persist updated artifact back to main thread if the agent produced one
    if updated_content:
        main_config = {"configurable": {"thread_id": request.thread_id}}
        state_update = (
            {"architecture_draft": updated_content, "user_stories_draft": ""}
            if stage == "architecture"
            else {"user_stories_draft": updated_content}
        )
        try:
            graph.update_state(main_config, state_update)
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=error_detail("state_error", f"Failed to persist updated {stage}: {exc}"),
            )

    return StageChatResponse(ai_response=ai_message, updated_content=updated_content)


@app.get("/api/stage/{stage}/chat/{thread_id}", response_model=StageHistoryResponse)
async def get_stage_chat_history(stage: str, thread_id: str):
    """Return the persisted stage chat history for a given thread."""
    if stage not in VALID_STAGES:
        raise HTTPException(
            status_code=400,
            detail=error_detail("invalid_stage", f"Stage must be one of: {sorted(VALID_STAGES)}"),
        )
    messages = _load_stage_messages(thread_id, stage)
    return StageHistoryResponse(
        messages=[StageHistoryMessage(role=m["role"], content=m["content"]) for m in messages]
    )


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


class PushToGitHubRequest(BaseModel):
    thread_id: str
    model_choice: str = "ollama"
    github_owner: str
    github_repo: str
    github_token: str


class PushToGitHubResponse(BaseModel):
    success: bool
    created_issues: list[str]
    count: int


class DeliveryPreviewRequest(BaseModel):
    thread_id: str
    model_choice: str = "ollama"
    target: str
    jira_project_key: str = ""
    github_owner: str = ""
    github_repo: str = ""


class DeliveryPreviewResponse(BaseModel):
    target: str
    items: list[dict]
    payload_preview: list[dict]


class DeliveryPublishRequest(BaseModel):
    thread_id: str
    model_choice: str = "ollama"
    target: str
    jira_domain: str = ""
    jira_email: str = ""
    jira_token: str = ""
    jira_project_key: str = ""
    github_owner: str = ""
    github_repo: str = ""
    github_token: str = ""


class DeliveryPublishResponse(BaseModel):
    success: bool
    target: str
    created_items: list[str]
    count: int


@app.post("/api/delivery/preview", response_model=DeliveryPreviewResponse)
async def preview_delivery(request: DeliveryPreviewRequest):
    model_choice = validate_model_choice(request.model_choice)
    target = validate_delivery_target(request.target)
    parsed_items = parse_delivery_items_or_raise(request.thread_id, model_choice)
    items = delivery_items_to_json(parsed_items)
    preview = DELIVERY_INTEGRATIONS[target].preview(
        parsed_items,
        build_delivery_config(
            target,
            require_credentials=False,
            jira_project_key=request.jira_project_key,
            github_owner=request.github_owner,
            github_repo=request.github_repo,
        ),
    )
    return DeliveryPreviewResponse(target=target, items=items, payload_preview=preview)


@app.post("/api/delivery/publish", response_model=DeliveryPublishResponse)
async def publish_delivery(request: DeliveryPublishRequest):
    model_choice = validate_model_choice(request.model_choice)
    target = validate_delivery_target(request.target)
    items = parse_delivery_items_or_raise(request.thread_id, model_choice)
    config = build_delivery_config(
        target,
        jira_domain=request.jira_domain,
        jira_email=request.jira_email,
        jira_token=request.jira_token,
        jira_project_key=request.jira_project_key,
        github_owner=request.github_owner,
        github_repo=request.github_repo,
        github_token=request.github_token,
    )
    try:
        result = DELIVERY_INTEGRATIONS[target].publish(items, config)
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace")
        category = "jira_api_error" if target == "jira" else "github_api_error"
        raise HTTPException(
            status_code=502,
            detail=error_detail(category, f"{target} API error (HTTP {exc.code}): {error_body}"),
        ) from exc
    except urllib.error.URLError as exc:
        category = "jira_network_error" if target == "jira" else "github_network_error"
        raise HTTPException(
            status_code=502,
            detail=error_detail(category, f"Could not reach {target}: {exc.reason}"),
        ) from exc
    except Exception as exc:
        category = f"{target}_error"
        raise HTTPException(
            status_code=502,
            detail=error_detail(category, str(exc)),
        ) from exc

    return DeliveryPublishResponse(
        success=result.success,
        target=result.target,
        created_items=result.created,
        count=result.count,
    )


@app.post("/api/push_to_jira", response_model=PushToJiraResponse)
async def push_to_jira(request: PushToJiraRequest):
    result = await publish_delivery(
        DeliveryPublishRequest(
            thread_id=request.thread_id,
            model_choice=request.model_choice,
            target="jira",
            jira_domain=request.jira_domain,
            jira_email=request.jira_email,
            jira_token=request.jira_token,
            jira_project_key=request.jira_project_key,
        )
    )
    return PushToJiraResponse(
        success=result.success,
        created_issues=result.created_items,
        count=result.count,
    )


@app.post("/api/push_to_github", response_model=PushToGitHubResponse)
async def push_to_github(request: PushToGitHubRequest):
    result = await publish_delivery(
        DeliveryPublishRequest(
            thread_id=request.thread_id,
            model_choice=request.model_choice,
            target="github",
            github_owner=request.github_owner,
            github_repo=request.github_repo,
            github_token=request.github_token,
        )
    )
    return PushToGitHubResponse(
        success=result.success,
        created_issues=result.created_items,
        count=result.count,
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
    try:
        projects = list_jira_projects(domain, email, token)
        return JiraProjectsResponse(
            projects=[JiraProject(**project) for project in projects]
        )
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise HTTPException(
                status_code=401,
                detail=error_detail("jira_auth_error", "Invalid Jira credentials"),
            )
        raise HTTPException(
            status_code=502,
            detail=error_detail("jira_api_error", f"Jira error: {exc.reason}"),
        )
    except urllib.error.URLError as exc:
        raise HTTPException(
            status_code=502,
            detail=error_detail(
                "jira_network_error",
                f"Could not reach Jira at '{domain}': {exc.reason}",
            ),
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=error_detail("jira_error", str(exc)),
        )


# ---------------------------------------------------------------------------
# GitHub repos list endpoint
# ---------------------------------------------------------------------------

class GitHubRepo(BaseModel):
    full_name: str
    owner: str
    name: str


class GitHubReposResponse(BaseModel):
    repos: list[GitHubRepo]


@app.get("/api/github/repos", response_model=GitHubReposResponse)
async def get_github_repos(token: str):
    """Fetch all repos accessible by the given GitHub token."""
    try:
        repos = list_github_repos(token)
        return GitHubReposResponse(repos=[GitHubRepo(**r) for r in repos])
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise HTTPException(
                status_code=401,
                detail=error_detail("github_auth_error", "Invalid GitHub token"),
            )
        raise HTTPException(
            status_code=502,
            detail=error_detail("github_api_error", f"GitHub error: {exc.reason}"),
        )
    except urllib.error.URLError as exc:
        raise HTTPException(
            status_code=502,
            detail=error_detail("github_network_error", f"Could not reach GitHub: {exc.reason}"),
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=error_detail("github_error", str(exc)),
        )


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
            detail=error_detail("state_error", f"Failed to reset PRD for thread '{thread_id}': {exc}"),
        )
    return ResetPrdResponse(success=True)


# ---------------------------------------------------------------------------
# Export endpoint
# ---------------------------------------------------------------------------

@app.get("/api/export/{thread_id}")
async def export_project(thread_id: str, format: str = "markdown"):
    """
    Export the full project document (PRD + Architecture) as a downloadable Markdown file.
    Returns HTTP 400 if both sections are empty.
    """
    artifacts = get_project_artifacts(thread_id)

    if not artifacts.prd and not artifacts.architecture and not artifacts.user_stories:
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "export_empty",
                "Nothing to export — PRD, architecture, and user stories are all empty.",
            ),
        )

    if format not in {"markdown", "json"}:
        raise HTTPException(
            status_code=400,
            detail=error_detail(
                "invalid_export_format",
                f"Unsupported export format '{format}'. Valid options: ['json', 'markdown']",
            ),
        )

    if format == "json":
        return JSONResponse(content=export_project_json(artifacts))

    return Response(
        content=export_project_markdown(artifacts),
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


@app.get("/api/models/check", response_model=ModelsCheckResponse)
async def check_models():
    """
    Probe each supported AI backend and return which ones are reachable.
    Checks run concurrently to minimise latency.
    """
    checks = await asyncio.gather(
        *(asyncio.to_thread(adapter.is_available) for adapter in MODEL_ADAPTERS.values())
    )
    available = [
        adapter.model_choice
        for adapter, is_available in zip(MODEL_ADAPTERS.values(), checks)
        if is_available
    ]

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
            detail=error_detail(
                "unsupported_file_type",
                f"Unsupported file type '{ext}'. "
                f"Supported: {sorted(SUPPORTED_EXTENSIONS)}",
            ),
        )

    try:
        raw = await file.read()
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=error_detail("file_read_error", f"Failed to read uploaded file: {exc}"),
        )

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
                detail=error_detail("file_parse_error", f"Failed to parse '{filename}': {exc}"),
        )

    if not content.strip():
        raise HTTPException(
            status_code=422,
            detail=error_detail(
                "file_parse_error",
                f"No text content could be extracted from '{filename}'.",
            ),
        )

    return UploadResponse(filename=filename, content=content)
