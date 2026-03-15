# Change Log

## [Released]

### 1.3.0

This release adds smarter `mod.rs` visibility controls, improves safety around ignored paths like `.git`, and refactors the extension internals for better maintainability and testability.

#### Added

- Smart hiding for `mod.rs` files that behave only like indexes.
- Manual hide for a single `mod.rs` through the Explorer context menu.
- Restore flow for manually hidden `mod.rs` files.
- Real integration tests for Explorer commands and `files.exclude`.
- Dedicated tests for `mod.rs` content editing and visibility heuristics.
- Regression test to guarantee that files inside `.git` are ignored.

#### Changed

- Refactored the `automod` core into smaller modules for declaration parsing, content editing, file IO, and `cargo fmt`.
- Migrated hot file operations away from `fs.*Sync` to async flows.
- Introduced workspace-scoped services for persisted extension state and visibility management.
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
