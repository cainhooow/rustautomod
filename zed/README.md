# Rust AutoMod for Zed

This folder contains a Zed adaptation of Rust AutoMod that is designed to be installed as a dev extension from `zed/`.

The `zed/` folder now includes its own `.gitignore`, so local Cargo `target/` outputs do not get swept into commits by accident.

Important: this Zed version still does not open a Studio panel or sidebar after installation. Zed does not currently expose the same UI surface used by the VS Code Studio. The visible entry points after install are now:

- `.rautomod` file support inside the editor
- Rust code actions inside `.rs` files, once the Rust AutoMod language server is enabled for Rust
- automatic daemon-backed sync for closed Rust module targets when files are created, removed, or renamed inside the worktree
- slash commands inside the Assistant

## What this Zed package includes

- `.rautomod` file recognition with best-effort syntax highlighting using the TOML grammar.
- In-editor `.rautomod` diagnostics for invalid keys and values.
- In-editor hover help for known `.rautomod` keys and common values.
- In-editor completions for `.rautomod` keys and value enums.
- `Format Document` support for `.rautomod` through a bundled language server.
- Rust code actions for `.rs` files that can:
  - register the current module in its parent target
  - create the missing parent target and register the module when possible
  - sync missing child module declarations inside `mod.rs`, `lib.rs`, `main.rs`, or modern `folder.rs` targets
- A Rust daemon watcher that:
  - watches the worktree for Rust file create, delete, and rename events
  - batches changes through a debounced sync pass
  - updates closed module targets automatically
  - only creates a missing direct target when a real Rust file create/rename event requires it, instead of materializing broad `mod.rs` files during generic rescans
  - only manages paths that are actually inside the scope of a real `.rautomod` file, instead of treating the whole crate as implicitly managed
  - preserves the visibility/cfg style of existing declarations in already-managed targets, only adding or removing what changed
  - trims trailing whitespace and collapses stale blank-line runs when rewriting an already-managed target
  - mirrors the VS Code extension more closely for declaration placement around `use` blocks, including multiline `use { ... }` groups and `group_order` handling
  - skips files that are currently open in the editor, so it does not fight buffer state or undo history
  - suppresses its own file-system echoes to avoid cascading loops
- Slash commands for the core manual workflows that fit Zed's current extension surfaces:
  - `/rautomod-help`
  - `/rautomod-scaffold`
  - `/rautomod-format <relative-path-to-.rautomod>`
  - `/rautomod-audit [relative-path-to-.rautomod]`
  - `/rautomod-explain <relative-path-to-rust-file>`
  - `/rautomod-create-pair <directory> <module> [visibility] [layout]`
- A local Node bridge that performs `.rautomod` parsing, formatting, auditing, config resolution, and module-pair creation inside the current worktree.
- A Rust JSON-RPC daemon that powers Rust-side code actions and automatic safe module-target synchronization.

## What is intentionally not mirrored from the VS Code extension

Zed does not currently expose the same kind of extension UI or event surface used by the VS Code version for:

- the visual `.rautomod Studio`
- the workspace manager panel
- Explorer context menus
- smart Explorer hiding for `mod.rs`

The new Rust daemon does cover the automatic Rust-file watcher side for module-target synchronization, but the Studio UI, manager surface, Explorer integrations, and smart hide flows are still VS Code-only.

## Install locally in Zed

1. Open Zed.
2. Run `zed: extensions`.
3. Click `Install Dev Extension`.
4. Select the `zed/` directory from this repository.
5. Reload Zed or run the action that reloads extensions if it does not pick the dev extension immediately.
6. Open a `.rautomod` file and confirm that Zed recognizes it as `Rust AutoMod`.
7. Try `Format Document` on that `.rautomod` file.
8. Enable the Rust code-actions server in your Zed settings:

```json
{
  "languages": {
    "Rust": {
      "language_servers": ["rustautomod-rust-actions", "..."]
    }
  }
}
```

9. Ensure `cargo` is available in the environment Zed uses, because the Rust actions server now runs through a bundled Rust daemon.
10. Open a Rust file and trigger Code Actions to check for `Rust AutoMod` actions.
11. Create, rename, or delete a Rust file with the target file closed to verify the watcher-driven auto-sync flow.
12. Open the Assistant and try `/rautomod-help`.

## Command examples

Use these from the Assistant in Zed:

- `/rautomod-help`
- `/rautomod-scaffold`
- `/rautomod-scaffold src/application/queries`
- `/rautomod-format .rautomod`
- `/rautomod-audit`
- `/rautomod-audit src/application/queries/.rautomod`
- `/rautomod-explain src/application/queries/user_query.rs`
- `/rautomod-create-pair src/application queries pub(crate) modern`

## Rust code-action examples

After enabling `rustautomod-rust-actions` for the `Rust` language, open a Rust file and request code actions.

Typical results:

- Open `src/application/queries/user_query.rs` after creating it manually and use `Rust AutoMod: Register this module in the parent target`.
- Open `src/application/queries.rs` or `src/application/queries/mod.rs` and use `Rust AutoMod: Register missing child modules`.
- Open `src/application/queries/mod.rs` when the parent target does not exist yet and use `Rust AutoMod: Create parent target and register this module`.

## Notes

- The slash-command implementation needs a working `node` binary in the environment used by Zed.
- The bundled `.rautomod` language server also needs a working `node` binary in the environment used by Zed.
- The Rust code-action language server now runs through the bundled Rust daemon and therefore needs a working `cargo` binary in the environment used by Zed.
- If the Rust code actions do not appear, confirm that your Zed settings include `"rustautomod-rust-actions"` in `languages.Rust.language_servers`.
- On Windows, the package now launches the bundled Node entrypoints by absolute extension path instead of through the worktree cwd, and the Rust actions server no longer depends on Node at all.
- The Rust daemon intentionally skips automatic writes for targets that are open in the editor. In that case, use the offered Rust AutoMod code action instead.
- The Rust daemon also cleans up stale repeated `// rustautomod` marker lines instead of endlessly stacking them in target files.
- The Rust daemon now also keeps target spacing tighter by discarding stray leading blank lines that were previously getting attached to reused declaration blocks.
- The Rust daemon speaks JSON-RPC over stdio. Today Zed uses it as a light LSP-style client, but the daemon also exposes room for future explicit sync/status calls.
- The `.rautomod` highlighting is still best-effort for now. A dedicated Tree-sitter grammar would be the next step for higher-fidelity highlighting.
