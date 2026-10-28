---
name: archguide
description: Use the project's architecture model (architecture/*.archguide.json) when planning features, mapping the repo, or making structural changes in this React + Node.js + PostgreSQL codebase. Use before adding services, modules, routes, tables, queues or cross-package imports.
---

# ArchitectureGuide

The architecture model lives in `architecture/`. `architecture/ARCHITECTURE.md` is the readable version.
Change the model only through the MCP write tools (server `archguide`) or the `archguide` CLI, never by
editing the JSON by hand. When `npx archguide serve` runs, every change shows up live in the browser.

## Before you plan a feature

1. Read the architecture: MCP `get_architecture` (use `focus` on the area you will change), or read
   `architecture/ARCHITECTURE.md`.
2. Follow every line under "Invariants". Do not "fix" items listed under "Known issues".
3. Model the change: `get_catalog` for the concepts, then `upsert_elements` and `upsert_relations`
   (new items get `status: "planned"`), or `apply_template` for a whole pattern. The MCP prompt
   `plan-feature` walks through it.
4. Each write returns only the findings it introduced. Fix them (`apply_quick_fix`, or a better design)
   or accept them on purpose with `suppress_finding` and a real reason. Record important choices with
   `add_decision`.
5. Run `validate_project`, then `export` with `format: "agent-md"` and `write: true` so
   `ARCHITECTURE.md` stays current.

## After a structural change

- Update the model with the MCP write tools.
- Run `npx archguide validate`. It must exit with code 0.

## When the repo has no model yet

`npx archguide init --template T1` (or without `--template` for an empty project), then model the
deployables, modules and data stores with the MCP tools.

## When you join a project or explain it to someone

Read the onboarding pack (MCP `get_onboarding`, or `npx archguide onboarding`). For any concept you are
unsure about, call `explain_concept` (or `npx archguide explain <id>`) instead of guessing.

## Without MCP

Every read and export has a CLI equivalent: `npx archguide --help`.
