#!/usr/bin/env python3
"""JSON-lines bridge between Aster's daemon and Google Antigravity SDK.

Secrets are never accepted in the request payload. Authentication is resolved by
the official SDK from documented environment variables or Google Cloud ADC.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import subprocess
import sys
from typing import Any


def emit(kind: str, **data: Any) -> None:
    print(json.dumps({"kind": kind, **data}, separators=(",", ":")), flush=True)


def cloud_coordinates() -> tuple[str | None, str | None]:
    project = os.environ.get("GOOGLE_CLOUD_PROJECT")
    if not project:
        try:
            result = subprocess.run(
                ["gcloud", "config", "get-value", "project", "--quiet"],
                capture_output=True, check=False, text=True, timeout=5,
            )
            candidate = result.stdout.strip()
            if result.returncode == 0 and candidate and candidate != "(unset)":
                project = candidate
        except (FileNotFoundError, subprocess.SubprocessError):
            pass
    location = os.environ.get("GOOGLE_CLOUD_LOCATION") or ("us-central1" if project else None)
    return project, location


def credential_status() -> dict[str, Any]:
    adc_path = Path(os.environ.get(
        "GOOGLE_APPLICATION_CREDENTIALS",
        str(Path.home() / ".config" / "gcloud" / "application_default_credentials.json"),
    ))
    project, location = cloud_coordinates()
    developer_key = bool(os.environ.get("GEMINI_API_KEY"))
    vertex_key = bool(os.environ.get("ASTER_VERTEX_API_KEY") or os.environ.get("VERTEX_API_KEY"))
    adc = adc_path.is_file()
    selected = os.environ.get("ASTER_ANTIGRAVITY_AUTH", "auto").lower()
    if selected == "auto":
        selected = (
            "gemini-api-key" if developer_key else
            "vertex-express" if vertex_key else
            "vertex-adc" if adc and project and location else
            "unconfigured"
        )
    configured = (
        (selected == "gemini-api-key" and developer_key) or
        (selected == "vertex-express" and vertex_key) or
        (selected == "vertex-adc" and adc and bool(project and location))
    )
    return {
        "configured": configured,
        "authMode": selected,
        "geminiApiKeyAvailable": developer_key,
        "vertexExpressKeyAvailable": vertex_key,
        "adcAvailable": adc,
        "cloudProjectAvailable": bool(project),
        "cloudLocationAvailable": bool(location),
    }


def status() -> int:
    try:
        version = importlib.metadata.version("google-antigravity")
        from google.antigravity.models import DEFAULT_MODEL
    except (ImportError, importlib.metadata.PackageNotFoundError) as error:
        emit("status", installed=False, configured=False, error=str(error))
        return 0
    emit(
        "status",
        installed=True,
        version=version,
        defaultModel=DEFAULT_MODEL,
        supportedAuthModes=["gemini-api-key", "vertex-express", "vertex-adc"],
        **credential_status(),
    )
    return 0


def endpoint_for(auth_mode: str):
    from google.antigravity import GeminiAPIEndpoint, VertexEndpoint

    if auth_mode == "gemini-api-key":
        return GeminiAPIEndpoint()
    if auth_mode == "vertex-express":
        key = os.environ.get("ASTER_VERTEX_API_KEY") or os.environ.get("VERTEX_API_KEY")
        return VertexEndpoint(api_key=key)
    if auth_mode == "vertex-adc":
        project, location = cloud_coordinates()
        return VertexEndpoint(
            project=project,
            location=location,
        )
    raise ValueError(
        "Antigravity SDK is not authenticated. Configure GEMINI_API_KEY, "
        "VERTEX_API_KEY, or Google Cloud ADC with GOOGLE_CLOUD_PROJECT and "
        "GOOGLE_CLOUD_LOCATION."
    )


def stable_conversation_id(task_id: str) -> str:
    return hashlib.sha256(f"aster:antigravity-sdk:{task_id}".encode()).hexdigest()[:32]


async def run_agent(request: dict[str, Any]) -> int:
    from google.antigravity import (
        Agent,
        AgentBehavior,
        BuiltinTools,
        CapabilitiesConfig,
        GeminiModelOptions,
        LocalAgentConfig,
        ModelTarget,
        ModelType,
        ThinkingLevel,
    )
    from google.antigravity.models import DEFAULT_MODEL
    from google.antigravity.hooks import policy
    from google.antigravity.types import SessionContinuationMode, Text, Thought, ToolCall, ToolResult

    auth = credential_status()
    provider = str(request.get("provider") or "antigravity")
    provider_auth = {
        "antigravity-gemini": "gemini-api-key",
        "antigravity-vertex": "vertex-express",
    }.get(provider)
    auth_mode = str(request.get("authMode") or provider_auth or auth["authMode"])
    endpoint = endpoint_for(auth_mode)
    effort = str(request.get("effort") or "medium").lower()
    thinking = {
        "minimal": ThinkingLevel.MINIMAL,
        "low": ThinkingLevel.LOW,
        "medium": ThinkingLevel.MEDIUM,
        "high": ThinkingLevel.HIGH,
        "max": ThinkingLevel.EXTRA_HIGH,
    }.get(effort, ThinkingLevel.MEDIUM)
    endpoint.options = GeminiModelOptions(thinking_level=thinking)
    raw_model = str(request.get("model") or "")
    model_name = raw_model.split(":", 1)[1] if ":" in raw_model else raw_model
    model_name = model_name or None
    model = ModelTarget(
        name=DEFAULT_MODEL if model_name in (None, "auto") else model_name,
        types=[ModelType.TEXT],
        endpoint=endpoint,
    )
    mode = str(request.get("mode") or "manual")
    read_only = BuiltinTools.read_only()
    capabilities = CapabilitiesConfig(
        agent_behavior=AgentBehavior.INTERACTIVE if mode in ("plan", "manual") else AgentBehavior.AUTONOMOUS,
        enabled_tools=read_only if mode == "plan" else None,
        enable_subagents=mode != "plan",
    )
    policies = [policy.allow_all()] if mode == "full-access" else None
    workspace = str(Path(str(request["workspaceRoot"])).resolve())
    save_dir = str(Path(str(request["dataRoot"])) / "antigravity-sdk" / "sessions")
    Path(save_dir).mkdir(parents=True, exist_ok=True)
    config = LocalAgentConfig(
        models=[model],
        capabilities=capabilities,
        policies=policies,
        workspaces=[workspace],
        save_dir=save_dir,
        app_data_dir=save_dir,
        conversation_id=stable_conversation_id(str(request["taskId"])),
        session_continuation_mode=SessionContinuationMode.CREATE_OR_RESUME,
    )

    async with Agent(config) as agent:
        response = await agent.chat(str(request["prompt"]))
        async for chunk in response.chunks:
            if isinstance(chunk, Text):
                emit("assistant_delta", text=chunk.text)
            elif isinstance(chunk, Thought):
                emit("thought_delta", text=chunk.text)
            elif isinstance(chunk, ToolCall):
                emit("tool_call", tool=chunk.name, input=chunk.args, callId=chunk.id or "")
            elif isinstance(chunk, ToolResult):
                emit("tool_result", tool=chunk.name or "antigravity-tool", ok=not bool(chunk.error), summary=str(chunk.result or chunk.error or ""), callId=chunk.id or "")
        usage = response.usage_metadata
        if usage is not None:
            emit(
                "usage",
                input=usage.prompt_token_count or 0,
                output=(usage.candidates_token_count or 0) + (usage.thoughts_token_count or 0),
            )
        emit("settled", conversationId=agent.conversation_id)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("status", "run"))
    args = parser.parse_args()
    if args.command == "status":
        return status()
    try:
        request = json.load(sys.stdin)
        return asyncio.run(run_agent(request))
    except Exception as error:  # Bridge errors are provider-neutral structured events.
        emit("error", message=f"{type(error).__name__}: {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
