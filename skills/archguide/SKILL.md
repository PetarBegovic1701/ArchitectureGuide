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
3. For a non-trivial feature, start a change set: `create_change_set` with a name and the feature as
   the description. Pass its ID as `changeSetId` to every step below; the baseline stays as it is.
   The MCP prompt `plan-feature` walks through it.
4. Model the change: `get_catalog` for the concepts, then `upsert_elements` and `upsert_relations`
   (new items get `status: "planned"`), or `apply_template` for a whole pattern.
5. Each write returns only the findings it introduced. Fix them (`apply_quick_fix`, or a better design)
   or accept them on purpose with `suppress_finding` and a real reason. Record important choices with
   `add_decision`. `validate_project` with `changeSetId` until the change introduces no errors.
6. `generate_tasks`, then `export` with `format: "plan-md"`, `changeSetId` and `write: true` (also
   `speckit` or `kiro` if the repository uses them). Implement the tasks in order.
7. When the code is done and `npx archguide check` passes, `update_change_set` with
   `status: "implemented"` merges the change into the model. Then `export` agent-md with `write: true`
   so `ARCHITECTURE.md` stays current.

## After a structural change

- Update the model with the MCP write tools, or run `diff_with_repository` and `apply_analysis`
  (CLI: `npx archguide analyze --write`) and review what it added.
- Run `npx archguide check`. It must exit with code 0: it runs the model rules, the code
  findings (file and line) and the dependency rules generated from the model.

## When the repo has no model yet

Use the MCP prompt `map-repository`, or `npx archguide init && npx archguide analyze --write`, then
correct names and responsibilities with the MCP tools and `export` agent-md with `write: true`.

Keep the model faithful to the code, also where the code is wrong. If the code does something
the rules refuse, add it as it is with `antiPattern: { note, evidence }` (or `asFound: true` on
the call) instead of leaving it out or drawing the design it should have. Rule AP-019 reports it
as something to address; list these anti-patterns in your report.

Then document the blocks with `write_documentation`: for each deployable, module and data store, its
name, description (what it is) and function (what it does), as you read them in the README, docs and
comments (`basis: "read"`) or deduced them from the code (`basis: "deduced"`), with the files as
`sources`. Write in the language the repository's documentation uses, do not translate, and set
`project.lang` to its BCP 47 tag (`"en"`, `"de"`, `"sr-Latn"`). The editor shows these texts on the
diagram as written.

## When you join a project or explain it to someone

Read the onboarding pack (MCP `get_onboarding`, or `npx archguide onboarding`). For any concept you are
unsure about, call `explain_concept` (or `npx archguide explain <id>`) instead of guessing.

## Without MCP

Every read, export and check has a CLI equivalent: `npx archguide --help`.
