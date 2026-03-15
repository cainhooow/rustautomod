# Rust Automod

![RustAutomod Logo By Saki](assets/automodlogo.png)

Art produced by [Saki](https://instagram.com/sak1_sk)

Rust Automod is a Visual Studio Code extension that keeps Rust module files in sync for you. It creates and updates `mod.rs`, `lib.rs`, and `main.rs` module declarations automatically, supports `.rautomod` project rules, adds syntax highlighting and formatting for `.rautomod`, and now includes smarter `mod.rs` visibility controls inside the VS Code Explorer.

## What it does

- Creates `mod.rs` when a new Rust file appears in a module folder.
- Updates `mod.rs`, `lib.rs`, or `main.rs` when modules are added or removed.
- Supports nested folders and parent module registration.
- Supports `.rautomod` rules for `visibility`, `sort`, `cfg`, `pattern`, and `fmt`.
- Can run `cargo fmt` after updates.
- Adds a dedicated file icon, syntax highlighting, linting, completions, and formatting for `.rautomod`.
- Hides `mod.rs` more intelligently in the Explorer.

## New mod.rs visibility features

Rust Automod now supports three Explorer workflows for `mod.rs`:

1. Smart hide for all index-like `mod.rs`
2. Manual hide for one specific `mod.rs`
3. Restore for both flows

### Smart hide

Use the command `Toggle Smart mod.rs Hiding`.

When it is enabled, the extension hides only `mod.rs` files that behave like lightweight indexes, such as files containing only:

- `mod foo;`
- `pub mod foo;`
- `#[cfg(...)]` attributes attached to those declarations
- `pub use ...;` re-exports

If a `mod.rs` contains real code, like functions, structs, impls, constants, inline modules with bodies, or any other implementation content, it stays visible.

### Manual hide

Right-click a `mod.rs` file in the Explorer and run:

- `Hide This mod.rs`

This hides only that file.

### Restore

To restore hidden files, use:

- `Restore Hidden mod.rs`

If you run it from the Explorer on a specific `mod.rs`, it restores that file directly.
If you run it from the Command Palette, the extension shows a picker with the manually hidden `mod.rs` files.

## Commands

- `Toggle Smart mod.rs Hiding`
- `Hide This mod.rs`
- `Restore Hidden mod.rs`

## .rautomod configuration

Place a `.rautomod` file at the root of your Rust project, or inside a subfolder, to customize behavior.

The file is now recognized as its own VS Code language, with a dedicated Explorer icon, colors for comments, keys, operators, known values, `cfg(...)` expressions, and list entries. You can also run `Format Document` on `.rautomod` files to normalize spacing, assignment style, blank lines, and comma-separated lists.

Example:

```rautomod
visibility=pub
sort=alpha
fmt=enabled
```

Available keys:

- `visibility=pub|private`
- `sort=alpha|none`
- `fmt=enabled|disabled`
- `cfg=feature="serde",all(unix, target_pointer_width = "64")`
- `pattern=utils,helpers,internal`

Example with patterns:

```rautomod
visibility=private
sort=none
fmt=disabled
pattern=utils,helpers

visibility=pub
sort=alpha
fmt=enabled
```

## Installation

1. Open VS Code.
2. Open Extensions.
3. Search for `Rust AutoMod`.
4. Install and reload the editor.

## Usage

1. Open a Rust project with a `Cargo.toml`.
2. Optionally add a `.rautomod` file.
3. Create or delete `.rs` files inside your module folders.
4. Use the Explorer commands when you want to hide or restore `mod.rs`.

## Internal structure

The extension was refactored so each responsibility lives in a smaller module.

### Automod core

- `src/automod/automodModFile.ts`: orchestration for create, delete, and rename flows
- `src/automod/modDeclarations.ts`: parsing and generation of module declaration blocks
- `src/automod/modContentEditor.ts`: insertion, removal, and sorting of declaration content
- `src/automod/modFileSystem.ts`: async file-system helpers and target-file resolution
- `src/automod/cargoFmt.ts`: isolated `cargo fmt` integration

### Visibility and workspace state

- `src/workbench/control.ts`: Explorer command/controller flow
- `src/workbench/modVisibility.ts`: index-like `mod.rs` detection and exclude reconciliation
- `src/workbench/modVisibilityWorkspaceService.ts`: per-workspace visibility persistence and `files.exclude` sync
- `src/workspace/workspaceStateService.ts`: generic workspace-scoped state storage

## Development

### Scripts

- `yarn compile`
- `yarn lint`
- `yarn test:unit`
- `yarn test`

### Test coverage

The project now includes:

- unit tests for visibility heuristics
- unit tests for `mod.rs` content editing
- unit tests for `.rautomod` formatting
- extension integration tests for Explorer commands and `files.exclude`
- extension integration tests for `.rautomod` language detection and formatting
- the existing debounce and rename-detection suites

## Notes

- `fmt=enabled` requires `cargo` and `rustfmt` to be available in your environment.
- If no `.rautomod` file is found, Rust Automod falls back to VS Code settings under `rustautomod.*`.
- The extension ignores invalid or unsafe paths such as `.git`, `target`, `node_modules`, and similar folders.

Contributions, issues, and feature requests are welcome.
