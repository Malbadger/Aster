---
name: orchestrate-aster-models
description: Coordinate build, review, audit, research, and verification phases across multiple local or remote models connected to Aster. Use when a user asks one model to call, delegate to, hand work to, compare with, review with, or orchestrate another model or provider.
---

# Orchestrate Aster models

Use Aster's provider-neutral delegation tools. Never search for or create vendor SDK clients, scripts such as `openai.py`, shell CLI commands, credential files, API keys, or direct HTTP calls.

## Resolve targets

1. Call the exposed tool whose name ends in `aster_list_models`. Its `defaults` map is authoritative for provider defaults.
2. When the user names an exact model, pass that exact provider-qualified ID as `model`.
3. When the user names only a provider, pass that provider as `provider` and omit `model`; Aster resolves the configured provider default deterministically.
4. When neither a provider nor model is named for a delegated role, ask for the missing target. The coordinator's current model is not an implicit delegation target.
5. Never select by substring, perceived strength, recency, or availability order. Never silently substitute a model.
6. If the exact model or configured default is missing, unavailable, or needs authentication, report that exact state and stop that phase unless the user explicitly authorized fallback.

## Delegate a phase

1. Give each target one bounded role: build, review, audit, research, test, or synthesize.
2. Construct a small handoff containing the objective, necessary context, constraints, workspace, and required return format. Do not forward the entire chat transcript.
3. For inspection, review, audit, or research, call the read-only tool ending in `aster_delegate_start` with `mode: plan`.
4. For requested workspace changes, call `aster_delegate_start_mutating` only when the current coordinating Aster phase is Auto or Full access. If it is Plan or Manual, tell the user to select Auto rather than bypassing the mode.
5. Supply either the exact target `model` or the target `provider`, plus your exact `caller_model`, the active absolute `workspace`, and a supported effort.
6. Poll the tool ending in `aster_delegate_get` until the task settles.
7. Treat the returned provider/model attribution, resolution source, status, and usage as authoritative. A completed task with no response is a failed phase, not a contribution.

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
