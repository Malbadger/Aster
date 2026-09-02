---
name: orchestrate-aster-models
description: Coordinate build, review, audit, research, and verification phases across multiple local or remote models connected to Aster. Use when a user asks one model to call, delegate to, hand work to, compare with, review with, or orchestrate another model or provider.
---

# Orchestrate Aster models

Use Aster's provider-neutral delegation tools. Never search for or create vendor SDK clients, scripts such as `openai.py`, shell CLI commands, credential files, API keys, or direct HTTP calls.

## Resolve targets

1. Call the exposed tool whose name ends in `aster_list_models`.
2. Match the user's requested provider and model to an exact provider-qualified model ID.
3. If the request is ambiguous, use the user's currently selected model only as coordinator and ask for the missing target. Never silently substitute a model.
4. If the requested target is unavailable or needs authentication, report that exact state and stop that phase.

## Delegate a phase

1. Give each target one bounded role: build, review, audit, research, test, or synthesize.
2. Construct a small handoff containing the objective, necessary context, constraints, workspace, and required return format. Do not forward the entire chat transcript.
3. For inspection, review, audit, or research, call the read-only tool ending in `aster_delegate_start` with `mode: plan`.
4. For requested workspace changes, call `aster_delegate_start_mutating` only when the current coordinating Aster phase is Auto or Full access. If it is Plan or Manual, tell the user to select Auto rather than bypassing the mode.
5. Supply the exact target `model`, your exact `caller_model`, the active absolute `workspace`, and a supported effort.
6. Poll the tool ending in `aster_delegate_get` until the task settles.
7. Treat the returned provider/model attribution as authoritative. Do not claim another model contributed unless its delegated task completed.

Never delegate back to yourself. Never ask a delegated model to delegate again; return control to the coordinator after one hop. Independent read-only phases may run in parallel, but phases that modify the same workspace must run sequentially.

## Return the combined result

- Label every contribution with its provider and exact model.
- Separate observations from changes actually made.
- Reconcile disagreements explicitly; do not blend conflicting answers into false consensus.
- Include failed, denied, unavailable, and exhausted phases in the result.
- Keep tool transcripts collapsed in the UI; summarize outcomes in prose.

Example handoff:

```text
Role: independent audit
Objective: verify the implementation against the stated acceptance criteria
Workspace: /absolute/project/path
Constraints: read-only; do not modify files; do not delegate further
Return: findings ordered by severity, test evidence, and a PASS/FAIL verdict
```
