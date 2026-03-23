# Change Log

## [Released]

### 1.9.6

This release adds a small repository-safety improvement for the Zed package.

#### Added

- Added `zed/.gitignore` so Cargo `target/` build output under `zed/` stays out of accidental `git add *` commits.

### 1.9.5

This release brings the Zed daemon target rewriter closer to the VS Code extension's declaration-placement behavior.

#### Fixed

- Managed `mod` and `pub mod` declarations in the Zed daemon now honor `use` blocks more like the VS Code extension, instead of drifting above imports in some targets.
- Multiline Rust `use { ... }` groups are now detected as a single import block when choosing where managed declarations should be inserted.
- The Zed daemon now respects `.rautomod` `group_order` when deciding whether managed declarations belong before or after the `use` block.

### 1.9.4

This release cleans up whitespace handling in Zed daemon rewrites so managed targets stop accumulating awkward spacing.

#### Fixed

- Reused declaration blocks in managed `mod.rs`, `lib.rs`, `main.rs`, and modern folder targets no longer pull leading blank lines into the rewritten output.
- Target rewrites now trim trailing whitespace and collapse stale blank-line runs more predictably, which keeps generated module files tighter after repeated sync passes.
- Managed declaration blocks now preserve a clean separation from the following code without injecting extra blank gaps inside the declaration list.

### 1.9.3

This release tightens the Zed daemon scope so automatic module management only happens where a real `.rautomod` actually applies.

#### Fixed

- The Zed daemon no longer manages `mod.rs`, `lib.rs`, or `main.rs` outside the subtree covered by an existing `.rautomod`.
- Automatic sync now stops climbing at the first ancestor target that is outside the active `.rautomod` scope, which prevents edits in broader crate files like `src/main.rs` when only a nested subtree is configured.

#### Changed

- In the Zed package, the automatic watcher and Rust code actions now treat a real `.rautomod` as the opt-in scope boundary for module management.

### 1.9.2

This release makes the Zed daemon more conservative about creating missing module targets.

#### Fixed

- Generic rescans and startup watcher noise no longer create broad missing `mod.rs` files in unrelated folders.
- The Zed daemon now limits automatic target creation to the direct target implied by a real Rust file create or rename event.

#### Changed

- Upstream watcher reconciliation now walks only through already-existing ancestor targets after the first missing direct target, which avoids unintended cascades of new `mod.rs` files.

### 1.9.1

This release hardens the new Zed daemon sync path so it behaves much closer to existing Rust projects instead of aggressively normalizing declaration blocks.

#### Fixed

- The Zed daemon now preserves existing private/public module declarations in already-managed targets instead of promoting older `mod foo;` lines to `pub mod foo;` during unrelated syncs.
- Automatic sync for nested module targets now correctly appends new entries like `entities/user.rs` into the local `entities/mod.rs` while keeping ancestor targets stable.
- Repeated `// rustautomod` marker lines are now deduplicated during daemon rewrites instead of piling up across sync passes.

#### Changed

- When there is no explicit `.rautomod` visibility rule, the Zed daemon now infers the local declaration style from the target file before generating new missing module entries.

### 1.9.0

This release upgrades the Zed adaptation from mostly manual helpers into a safer daemon-backed workflow for Rust module synchronization.

#### Added

- A bundled Rust daemon under `zed/daemon/` that speaks JSON-RPC over stdio and powers the Zed Rust actions server.
- Automatic watcher-driven sync in Zed for closed Rust module targets after file create, delete, and rename events.
- Debounced module-target reconciliation in the Zed daemon, with self-authored event suppression to avoid cascades and auto-edit loops.
- Safety guards so the Zed daemon skips automatic writes when the target file is currently open in the editor, leaving the fix available as a code action instead.
- A `rustautomod/syncNow` JSON-RPC entry point in the daemon for future explicit/manual sync triggers.

#### Changed

- The Zed Rust actions server no longer launches a Node script from the worktree cwd; it now runs through the bundled Rust daemon.
- The Zed package now resolves its remaining Node-based entrypoints by absolute extension path, fixing real-world startup failures caused by cwd-dependent script resolution.
- The Zed documentation now explains the new daemon requirements, watcher behavior, and the open-file safety model.

#### Fixed

- Fixed `MODULE_NOT_FOUND` startup failures in Zed where the Rust actions server tried to resolve `scripts/rautomod_zed_rust_language_server.js` from the user worktree instead of the extension package.
- Fixed the gap where the Zed package could format `.rautomod` and offer code actions but still failed to mirror the VS Code-style automatic module sync for closed files.

### 1.8.4

This release fixes the Zed package startup on Windows by avoiding oversized `node -e` spawns for the bundled language servers and slash-command bridge.

#### Fixed

- The Zed Rust code-action server now launches through bundled script entry files instead of giant inline `node -e` payloads, avoiding Windows error `206` during process spawn.
- The `.rautomod` language server and slash-command bridge in the Zed package now use the same shorter startup path for better cross-platform reliability.

### 1.8.3

This release makes the Zed adaptation more useful for day-to-day Rust editing by adding Rust code actions for module registration and module-target sync.

#### Added

- A second Zed language server for `Rust` that surfaces Rust AutoMod code actions directly inside `.rs` files.
- Rust-side code actions to register the current module in its parent target and sync missing child declarations in `mod.rs`, `lib.rs`, `main.rs`, and modern `folder.rs` targets.
- Automatic diagnostics in Zed Rust files when a module is not registered in the parent or when a target is missing child declarations.

#### Changed

- The Zed package was split into smaller bridge files so `.rautomod` parsing and Rust module actions are easier to maintain separately.
- The Zed documentation now explains the extra `languages.Rust.language_servers` setting needed to enable Rust AutoMod actions alongside the default Rust language server stack.

### 1.8.2

This release makes the early Zed adaptation visibly useful inside the editor instead of relying only on Assistant slash commands.

#### Added

- A bundled `.rautomod` language server for Zed with in-editor diagnostics, hover help, completions, and document formatting.
- A new `/rautomod-help` slash command for quickly verifying what the Zed package exposes.

#### Changed

- The Zed package description and documentation now explain the editor-facing `.rautomod` support more clearly.
- The Zed adaptation now behaves like a language-support package first, with Assistant slash commands as the secondary workflow.

### 1.8.1

This release clarifies the first Zed workflow and improves `.rautomod` matching for the Zed language package.

#### Changed

- The Zed documentation now makes it explicit that the current adaptation is driven by Assistant slash commands instead of a Studio-style panel.
- The Zed `.rautomod` language matcher now accepts both `rautomod` and `.rautomod` suffix forms to make file detection more reliable.

### 1.8.0

This release adds an initial Zed adaptation in `zed/`, giving the project a second editor target alongside the VS Code extension.

#### Added

- A standalone `zed/` extension package with its own `extension.toml`, `Cargo.toml`, license, and install documentation.
- Slash commands for Zed covering `.rautomod` scaffold, format, audit, explain, and module-pair creation workflows.
- A local Node bridge for the Zed package that handles `.rautomod` parsing, formatting, config resolution, and basic module-pair file updates.
- Best-effort `.rautomod` language registration for Zed with comments, brackets, and lightweight highlighting.

#### Notes

- The Zed package is intentionally focused on manual workflows and `.rautomod` support. The Studio UI, manager surface, Explorer actions, and file-watcher automation still remain VS Code-only because Zed does not currently expose equivalent extension surfaces.

### 1.7.4

This release makes the Studio manager tree update in place instead of re-rendering the full manager surface.

#### Fixed

- Opening or collapsing items in the module tree no longer shifts the page upward because the clicked branch is patched locally.
- Module-tree interactions now avoid full manager re-renders for expand/collapse, which keeps navigation steadier in deep trees.

### 1.7.3

This release smooths the Studio manager tree interaction so expanding and collapsing branches feels anchored instead of jumpy.

#### Fixed

- Expanding or collapsing a tree or sub-tree now preserves the clicked branch position instead of jumping the page upward.
- Tree summary clicks are now handled explicitly so the lazy-render path does not fight the browser's default `details/summary` scroll behavior.

### 1.7.2

This release fixes a Studio manager regression where the tree hydration path could keep toggling itself after render.

#### Fixed

- The manager module tree no longer enters a re-render loop after opening, which also restores normal page scrolling.
- Config cards and tree branches now ignore hydration toggles that do not represent a real user state change.

### 1.7.1

This release smooths out the Studio manager with a cleaner disclosure header and a lighter module-tree rendering path for large workspaces.

#### Changed

- The manager disclosure header now keeps its indicator inside the card frame even when the badge row gets crowded.
- The Studio module tree now lazily renders expanded branches so large nested hierarchies stay more responsive.

#### Fixed

- Tree open-state persistence now distinguishes between the default initial expansion and the user's explicit expand/collapse choices.
- The manager no longer keeps full hidden subtrees mounted in the DOM after branches are collapsed.

### 1.7.0

This release expands Rust AutoMod beyond `mod.rs`-only workflows, adding support for the modern Rust module layout, module-tree actions in Studio, smarter visibility tooling, and more robust manager behavior.

#### Added

- Automatic detection of classic `folder/mod.rs` and modern `folder.rs + folder/` module layouts.
- `Create Rust Module Pair` for scaffolding a child module with the correct file/folder shape and registering it in the parent target.
- `Set Module Visibility` for quickly switching a module declaration between `pub`, `pub(crate)`, and private.
- `Move Module to Crate Root` for relocating eligible leaf modules and regenerating declarations afterward.
- Studio manager module tree built from crate roots and resolved module declarations.
- Quick actions on module-tree nodes for opening files, creating children, changing visibility, and moving leaf modules upward.
- Integration coverage for modern target detection, modern module-pair creation, and module-tree rendering.

#### Changed

- `target=auto` now resolves folder modules with awareness of the surrounding project layout instead of assuming `mod.rs`.
- Regeneration now understands modern module-pair registration files when removing stale declarations.
- The Studio manager spacing was reworked so cards, badges, action rows, impact panels, audit panels, and playground blocks breathe better.
- README and Studio docs now document modern layouts, module-pair workflows, visibility controls, and the new module tree.

#### Fixed

- Manager refresh now tolerates workspace folders that were removed during tests or teardown instead of logging internal refresh failures.
- Module-visibility edits now preserve attached `#[cfg(...)]` lines while updating the declaration itself.
- Manager card actions now stay aligned to the correct config even when filters are active.

### 1.6.0

This release turns Rust AutoMod Studio into a deeper configuration surface, with comment-preserving visual saves, real draft state tracking, richer impact/audit tooling, and a more capable manager UI.

#### Added

- Visual editor support for preserving unmanaged comment blocks and non-managed sections when saving `.rautomod`.
- Real Studio draft state badges for saved, dirty, and diverged Visual/Raw edits.
- Local snapshot history inside the `.rautomod` visual editor.
- Impact preview and matching playground directly inside the `.rautomod` visual editor.
- Drag-and-drop rule reordering plus inline quick fixes for common rule/document mistakes.
- Workspace manager filters for strict mode, target mode, and config health.
- Manager-side audit summaries, sampled impact cards, and per-config why/why-not playgrounds.
- `screenshots:studio` script for regenerating the README Studio images.
- GitHub Actions workflow to compile, lint, test, and refresh Studio screenshots on CI.

#### Changed

- Studio cards now expose chip-based editing for `pattern`, `exclude`, `cfg`, and `extends`.
- Advanced rule settings moved into collapsible sections to keep the main editor cleaner.
- The manager UI now behaves more like a workspace audit console than a simple list of `.rautomod` files.
- The README and Studio docs now document the richer visual workflows and manager capabilities.

#### Fixed

- Visual saves no longer force leading unmanaged comment blocks to move below regenerated config headers.
- Custom editor and manager refresh flows now guard against disposed webviews during teardown.
- The screenshot generator now understands the richer Studio state used by the latest UI.

### 1.5.0

This release introduces Rust AutoMod Studio for `.rautomod`, adding a visual editing experience and a workspace manager UI while keeping the raw `.rautomod` file as the real source of truth.

#### Added

- Custom editor support for `.rautomod` with `Visual`, `Split`, and `Raw` modes.
- Workspace-wide Rust AutoMod manager UI for browsing configs, opening them visually, and scaffolding new ones.
- Product-style shared webview styling and front-end assets for the new Studio surfaces.
- Public `.rautomod` serialization helpers used by the visual editor pipeline.
- Documentation for the visual editor and manager flows in `docs/RAUTOMOD_STUDIO.md`.

#### Changed

- `Open Rust AutoMod Manager` now opens a full manager panel, while the activity bar container remains available as a secondary entry point.
- `.rautomod` can now be treated as both a text format and a visual editing surface inside VS Code.
- README documentation now explains when to use Visual, Split, and Raw workflows.

#### Notes

- Visual saves normalize the `.rautomod` structure and may rewrite comments or custom spacing, so `Raw` or `Split` mode is recommended when preserving hand-written notes matters.

### 1.4.0

This release expands Rust AutoMod from a module-sync helper into a more complete workflow tool, with preview, undo, regeneration, richer `.rautomod` rules, quick fixes, and better inspection/debugging commands.

#### Added

- Preview/dry-run support with diff output before applying automod changes.
- Undo for the last Rust AutoMod batch.
- Regenerate command for rebuilding module registrations in a folder or workspace.
- Explain command for showing why a Rust file maps to a given registration target and snippet.
- Effective-config inspector for Rust files.
- Structured Rust AutoMod output channel logging.
- Explorer command to ignore files or folders by writing `exclude=` rules into `.rautomod`.
- Scaffold command to create a starter `.rautomod`.
- Quick fixes for invalid `.rautomod` keys and a quick action to insert common missing keys.
- Integration coverage for scaffold, ignore, preview, regenerate, undo, and effective-config inspection.

#### Changed

- `.rautomod` now supports `exclude`, `extends`, `target`, `group_order`, `blank_lines`, `reexport`, `header`, `generated_comment`, `strict`, and `schema_version`.
- `pattern` rules now support negation with `!`.
- Visibility now supports `pub(crate)` and `pub(super)`.
- Sorting now supports `alpha_case_insensitive`, `pub_first`, and `cfg_first`.
- The automod runtime now applies batch operations through a shared preview/history/logging pipeline.

#### Fixed

- Rename handling now updates module declarations instead of only re-sorting the target file.
- Conflict detection warns before Rust AutoMod overwrites a managed declaration area that changed manually.
- Regeneration and undo flows are now covered by extension integration tests.

### 1.3.0

This release adds smarter `mod.rs` visibility controls, improves safety around ignored paths like `.git`, and refactors the extension internals for better maintainability and testability.

#### Added

- Smart hiding for `mod.rs` files that behave only like indexes.
- Manual hide for a single `mod.rs` through the Explorer context menu.
- Restore flow for manually hidden `mod.rs` files.
- Dedicated file icon for `.rautomod`.
- Syntax highlighting for `.rautomod` files, with dedicated tokens for comments, keys, values, and `cfg` expressions.
- Document formatting support for `.rautomod`.
- Real integration tests for Explorer commands and `files.exclude`.
- Dedicated tests for `mod.rs` content editing and visibility heuristics.
- Dedicated tests for `.rautomod` formatting.
- Regression test to guarantee that files inside `.git` are ignored.

#### Changed

- Refactored the `automod` core into smaller modules for declaration parsing, content editing, file IO, and `cargo fmt`.
- Migrated hot file operations away from `fs.*Sync` to async flows.
- Introduced workspace-scoped services for persisted extension state and visibility management.
- `.rautomod` completion and validation now share reusable parsing helpers with the formatter.
- Reworked the README and development scripts to reflect the new architecture and test setup.

#### Fixed

- `mod.rs` files with real implementation content are no longer hidden by the global hide flow.
- The extension now reliably ignores `.git` paths before attempting any module update.
- `files.exclude` synchronization now preserves unrelated user-defined exclusions.
- ESLint toolchain compatibility was fixed so linting runs again in the project.

### 1.2.0

Feat: Better operation with rust analyzer  
Functionality for renaming files, operation queues, etc...

### 1.1.9

Critical: Fixed extension modifying mod.rs files during git operations (rebases, branch switches, merges)

Previously, rapid file changes during git operations would trigger immediate processing for each file.  
This caused race conditions and unwanted modifications while git was still working.  
Issue reported by users experiencing corrupted module declarations after git operations.

### 1.1.7

Fix: The extension is treating an internal module (with body `{...}`) as if it were an external module declaration (which points to a file), causing it to be moved incorrectly by the sort function.

### 1.1.5

Fix for `build.rs` files.

### 1.1.3 - 1.1.4

This version introduces powerful new features for handling complex Rust projects and fixes major bugs related to module sorting and the handling of conditionally compiled modules.

#### Added

- Conditional compilation support via `.rautomod`.
- Automatic formatting with `cargo fmt`.

#### Fixed

- New module positioning around `use` statements.
- Handling of modules with multiple `#[cfg]` attributes.
- Parsing of complex `cfg` configurations.

### 1.1.2

- Fix issue when a `mod.rs` related file was deleted and all spaces in `mod.rs` were removed.
- Fix issue where changing branches could delete blank lines.

### 1.1.0

- `.rautomod` now supports the `pattern` option to apply visibility and sorting rules only to specific files or folders.
- Advanced configuration allows multiple patterns per rule.
- Updated `.rautomod` validator and autocomplete to support `pattern`.
- Examples and documentation added for basic and advanced `.rautomod` usage.
- IntelliSense now suggests pattern and example values for easier configuration.

#### Fixed

- Parser bug that ignored rules in `.rautomod` with patterns.
- Sorting and visibility now correctly respect `.rautomod` rules.

### 1.0.8

- Hide/show `mod.rs` files from the Command Palette.
