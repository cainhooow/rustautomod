# Rust AutoMod Use Cases

This guide collects practical scenarios for Rust AutoMod and shows how the extension and `.rautomod` can be combined in real projects.

## 1. Small library crate

When your crate is mostly a flat `src/` folder and you want `lib.rs` to stay clean automatically.

Structure:

```text
src/
  lib.rs
  api.rs
  errors.rs
  models.rs
```

Suggested `.rautomod`:

```rautomod
visibility=pub
sort=alpha
target=auto
fmt=enabled
```

Expected result in `src/lib.rs`:

```rust
pub mod api;
pub mod errors;
pub mod models;
```

Why this helps:

- avoids hand-editing `lib.rs` every time a file is added
- keeps ordering stable
- works well with preview before apply

## 2. Binary crate with `main.rs`

When the crate root is `main.rs` instead of `lib.rs`.

Structure:

```text
src/
  main.rs
  cli.rs
  commands.rs
```

Suggested `.rautomod`:

```rautomod
visibility=private
target=main.rs
sort=alpha
```

Expected result in `src/main.rs`:

```rust
mod cli;
mod commands;
```

Good fit for:

- CLIs
- small tools
- apps where crate internals should not be public

## 3. Internal helper folders

When only part of the project should stay private.

Structure:

```text
src/
  lib.rs
  api.rs
  internal/
    cache.rs
    parser.rs
```

Suggested `.rautomod`:

```rautomod
visibility=pub
sort=alpha

pattern=internal,!tests
visibility=private
sort=alpha_case_insensitive
target=mod.rs
```

Expected result in `src/internal/mod.rs`:

```rust
mod cache;
mod parser;
```

Expected result in `src/lib.rs`:

```rust
pub mod api;
pub mod internal;
```

Why this helps:

- public API and internal modules can follow different rules
- the override stays local to the matching folder

## 4. Platform-specific modules

When some declarations should always carry `cfg(...)`.

Suggested `.rautomod`:

```rautomod
pattern=platform
cfg=unix,windows
visibility=pub
sort=cfg_first
```

Generated lines may look like:

```rust
#[cfg(unix)]
pub mod socket;
#[cfg(windows)]
pub mod socket;
```

Use this when:

- platform folders should always be guarded
- you want cfg-managed declarations grouped first

## 5. Prelude or facade folders with re-exports

When you want the module file to declare and re-export matching submodules.

Suggested `.rautomod`:

```rautomod
pattern=prelude
visibility=pub
reexport=enabled
generated_comment=managed by rustautomod
group_order=cfg,pub_mod,mod,pub_use,use
```

Possible generated block:

```rust
// managed by rustautomod
pub mod fmt;
pub mod io;

pub use self::fmt::*;
pub use self::io::*;
```

Useful for:

- facade modules
- prelude modules
- feature bundles

## 6. Generated code or fixtures that must be ignored

When there are folders the extension should never touch.

Suggested `.rautomod`:

```rautomod
exclude=generated/**,fixtures/**,snapshots/**
```

This is especially useful when:

- build steps emit `.rs` files
- test fixtures should not become part of the module tree
- example code lives inside the repo but should stay manual

Explorer shortcut:

- right-click a file or folder
- choose `Ignore in .rautomod`

## 7. Shared rules with `extends`

When multiple folders should inherit a shared baseline.

`shared.rautomod`:

```rautomod
visibility=pub
sort=alpha
fmt=enabled
target=auto
```

Local `.rautomod`:

```rautomod
extends=./shared.rautomod
generated_comment=managed by rustautomod

pattern=internal
visibility=private
```

Why this helps:

- keeps repeated rules in one place
- lets teams share a baseline across packages or subtrees

## 8. Monorepo or workspace with different conventions

When one workspace contains multiple crates with different needs.

Example:

```text
crates/
  api/
    .rautomod
  cli/
    .rautomod
```

`crates/api/.rautomod`:

```rautomod
visibility=pub
target=lib.rs
```

`crates/cli/.rautomod`:

```rautomod
visibility=private
target=main.rs
```

This lets each crate follow its own module style while still using the same extension.

## 9. Previewing changes before large refactors

When you rename, move, or add many files and want safety first.

Recommended workflow:

1. Turn on `rustautomod.previewBeforeApply` in VS Code settings.
2. Use `Preview AutoMod Changes` on the folder you are refactoring.
3. Review the diff.
4. Apply the real refactor.
5. Use `Regenerate Rust Modules` if you want a cleanup pass after the move.

This is a great fit for:

- branch rebases
- larger folder splits
- reorganizing public API folders

## 10. Recovering from stale declarations

When the project already has stale `mod.rs`, `lib.rs`, or `main.rs` declarations.

Recommended workflow:

1. Run `Regenerate Rust Modules` on the folder or workspace.
2. Review the updated declarations.
3. If needed, use `Undo Last AutoMod Action`.
4. Use `Open Rust AutoMod Log` if you want to inspect what happened.

This is useful after:

- manual file moves outside VS Code
- branch switches
- generated file cleanup
- introducing a new `.rautomod`

## 11. Understanding why a file was handled a certain way

When the result is correct but not obvious.

Use:

- `Explain AutoMod Decision`
- `Show Effective AutoMod Config`

Typical questions these commands answer:

- why did this file go to `lib.rs` instead of `mod.rs`?
- which `.rautomod` file won?
- did `exclude=` make this file ignored?
- which `pattern=` matched?
- did `strict=error` block the change?

## 12. Team onboarding

When new contributors are not used to Rust module maintenance yet.

Suggested setup:

1. Commit a starter `.rautomod` scaffold into the repo.
2. Document a small team convention for `visibility`, `sort`, and `target`.
3. Encourage use of `Preview AutoMod Changes` for the first few PRs.
4. Keep `generated_comment=` enabled so managed blocks are obvious.

This lowers the learning curve and reduces manual `mod.rs` churn.

## Suggested starter configurations

### Conservative

```rautomod
schema_version=1
strict=warn
visibility=pub
sort=alpha
fmt=disabled
target=auto
generated_comment=managed by rustautomod
```

### Internal-heavy project

```rautomod
schema_version=1
strict=warn
visibility=pub
sort=alpha

pattern=internal,!tests
visibility=private
target=mod.rs
sort=alpha_case_insensitive
```

### Public facade style

```rautomod
schema_version=1
strict=warn
visibility=pub
sort=pub_first
reexport=enabled
group_order=cfg,pub_mod,mod,pub_use,use
generated_comment=managed by rustautomod
```

For the full key reference, see [RAUTOMOD_REFERENCE.md](RAUTOMOD_REFERENCE.md).
