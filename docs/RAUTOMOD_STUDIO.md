# Rust AutoMod Studio

Rust AutoMod Studio is the visual layer on top of `.rautomod`.

It keeps the text file as the source of truth, but adds two UI surfaces inside VS Code:

1. A per-file visual editor for each `.rautomod`
2. A manager UI for browsing and opening configs across the workspace

## Why it exists

`.rautomod` is still great as a raw text format because it works well with:

- Git diffs
- merges
- review workflows
- manual editing
- portability across machines

The Studio layer makes the same file easier to understand and configure, especially when:

- you are onboarding someone new to the extension
- you want to compare many rule blocks quickly
- you need a more guided way to edit `visibility`, `target`, `sort`, and related options
- you want a product-style configuration experience instead of only raw text

## The two UI surfaces

### 1. Per-file visual editor

Every `.rautomod` can open in a custom editor.

Ways to open it:

- open the file normally if the custom editor is the default
- right-click `.rautomod` in the Explorer and choose `Open .rautomod Visual`
- run `Open .rautomod Visual`

This editor supports three modes:

- `Visual`
- `Split`
- `Raw`

#### Visual mode

Visual mode turns the config into structured cards and fields.

What you can edit:

- `schema_version`
- `strict`
- `extends`
- `visibility`
- `sort`
- `fmt`
- `target`
- `pattern`
- `exclude`
- `cfg`
- `group_order`
- `blank_lines`
- `reexport`
- `header`
- `generated_comment`

What you can do:

- add a new rule block
- duplicate an existing rule block
- remove a rule block
- inspect diagnostics while editing
- apply the generated normalized `.rautomod`

#### Split mode

Split mode shows the visual editor and the raw file side by side.

Use it when:

- you want to learn the raw syntax while using the UI
- you want visual guardrails but still keep an eye on the exact text
- you want to preserve hand-written details and decide manually when to switch back

#### Raw mode

Raw mode gives you a focused editor-like text area inside the Studio UI.

Use it when:

- you care about exact formatting
- you want to keep comments and annotations
- you are testing a config quickly
- you want to paste examples from docs or other repos

Available actions:

- `Format Raw`
- `Apply Raw Changes`
- `Open Raw Externally`

## Manager UI

Rust AutoMod also includes a manager UI for the workspace.

Ways to open it:

- run `Open Rust AutoMod Manager`
- open the Rust AutoMod activity bar container and use the manager view

The manager is designed as a control surface for all `.rautomod` files in the workspace.

What it shows:

- total number of configs
- total number of rule blocks
- diagnostics across configs
- workspace folders
- every detected `.rautomod`

What you can do from the manager:

- search configs by path, workspace name, or strict mode
- open a config in the visual editor
- open a config in raw mode
- scaffold a new `.rautomod` at a workspace root
- jump to the Rust AutoMod log

## How the visual layer relates to the raw file

This is the most important design rule:

The visual UI does not introduce a second config format.

Instead:

- the real file remains `.rautomod`
- the parser reads that file
- the visual editor shapes a view model from it
- saving writes back to the same text file

That means:

- Git history still works normally
- reviews still happen against text diffs
- users can switch between UI and raw text
- there is no hidden database or binary state for config

## Current behavior and limitations

The Studio layer is already usable, but there are a few current trade-offs:

- visual saves normalize the file layout
- visual saves may rewrite comments and hand-tuned spacing
- raw mode is the safest place for comment-heavy or highly curated configs
- the manager focuses on config discovery and opening flows, not yet on full rule impact simulation

In practice:

- use `Visual` for structured editing
- use `Split` when you want confidence and visibility
- use `Raw` when you want exact textual control

## Recommended workflows

### New project

1. Open `Open Rust AutoMod Manager`
2. Scaffold a root `.rautomod`
3. Open it in the visual editor
4. Add your first default rule
5. Add scoped rules for private or generated folders

### Complex workspace

1. Open the manager
2. Filter configs by workspace or path
3. Open the relevant `.rautomod` in `Split`
4. Compare the raw text and the rule cards
5. Apply changes and then run `Regenerate Rust Modules`

### Comment-heavy config

1. Open the file in `Split`
2. Use visual mode to understand the structure
3. Finish in `Raw`
4. Use `Format Raw` only when you are comfortable with normalization

## Commands related to Studio

- `Open .rautomod Visual`
- `Open .rautomod Raw`
- `Open Rust AutoMod Manager`
- `Scaffold .rautomod`
- `Open Rust AutoMod Log`

## Design direction

The Studio UI is intentionally more product-like than a plain utility panel.

Its visual direction aims for:

- a stronger brand feel
- a more editorial and product-oriented presentation
- a control-surface mindset rather than a raw config dump
- a workflow closer to a settings UI, while still respecting the VS Code environment
