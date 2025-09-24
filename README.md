# Rust Automod

Rust Automod is a Visual Studio Code extension that automates the management of mod.rs files in Rust projects. It eliminates the repetitive task of manually creating and maintaining module declarations, keeping your Rust project structure clean and organized.

## 🚀 What It Solves

- In Rust, a folder without a `mod.rs` file is not automatically recognized as a module. This can lead to tedious manual work when creating new files or folders. Rust Automod automates this by:

- Automatically creating a `mod.rs` file when a new Rust file is added to a folder.

- Adding new module declarations (`mod` or `pub mod`) in the `mod.rs` file automatically.

- Creating `mod.rs` in nested folders and updating the parent module automatically.

- Removing module declarations when a Rust file is deleted.

- Ensuring modules are sorted alphabetically (optional) and avoiding duplicates.

- Supporting project-specific configuration through a `.rautomod` file.

- NEW: Toggle mod.rs visibility → Hide or show all `mod.rs` files in the VSCode Explorer with a single command, keeping your workspace cleaner.

## 📁 `.rautomod` Configuration

You can place a `.rautomod` file in the root of your Rust project (or any folder) to customize Automod behavior. The available configuration options are:

```.rautomod
# 'pub' for public modules (pub mod), 'private' for private modules (mod)
visibility=pub

# 'alpha' to sort module declarations alphabetically, 'none' to preserve insertion order
sort=alpha          

# 'enabled' to automatically run 'cargo fmt' after a change
fmt=enabled

# Comma-separated list of conditional compilation flags
cfg=feature="my_feature",unix

# Comma-separated list of file/folder names to apply this rule to
pattern=crate,private,another......
```

## Basic Usage

```.rautomod
visibility=pub
sort=alpha
```

- Creates all module declarations as `pub mod`.

- Sorts modules alphabetically in `mod.rs`.

## Advanced Usage with Patterns and Formatting

```.rautomod
# Make utils and helpers private, unsorted, and don't format them automatically
visibility=private
sort=none
fmt=disabled
pattern=utils,helpers

# Make all other modules public, sorted, and run 'cargo fmt' after changes
visibility=pub
sort=alpha
fmt=enabled
```

- The first block applies only to files/folders named `utils` or `helpers`.

- The second block (without `pattern`) is a fallback rule for all other files.

- Patterns support **comma-separated** lists and can match file or folder names.

## Advanced Configuration: Conditional Compilation (cfg)

For projects that require conditional compilation, you can use the `cfg` key. It accepts a comma-separated list of conditions. Automod will generate a `mod` declaration for each condition.

**Example** `.rautomod`:

```.rautomod
# This rule applies only to files/folders named 'advanced_mod'
visibility=pub
cfg=feature="serde_support", all(unix, target_pointer_width = "64")
pattern=advanced_mod
```

When you create a file named `advanced_mod.rs`, the extension will generate the following in `mod.rs`:

```rs
#[cfg(feature="serde_support")]
pub mod advanced_mod;
#[cfg(all(unix, target_pointer_width = "64"))]
pub mod advanced_mod;
```

## ⚡ Features

- **Automatic** `mod.rs` **creation**: No need to manually create `mod.rs` when adding a new Rust file.

- **Automatic module registration**: Updates parent `mod.rs` and child folders automatically.

- **Deletion support**: Removes module declarations when files are deleted.

- **Project-specific configuration**: `.rautomod` allows different settings per project.

- **Optional sorting**: Alphabetical ordering of module declarations.

- **NEW: Conditional Compilation Support**: Automatically add `#[cfg(...)]` attributes to new modules via `.rautomod.`

- **NEW: Automatic Formatting**: Optionally run `cargo fmt` after every change to keep code consistent.

- **IntelliSense support**: Autocomplete for `.rautomod` keys (`visibility`, `sort`, `pattern`, `cfg`, `fmt`) and values (`pub`, `private`, `alpha`, `none`, `enabled`, `disabled`).

- **Linting**: `.rautomod` is validated with inline errors in VSCode.

- **Hide/Show** `mod.rs` **files**: Quickly toggle the visibility of all mod.rs files via the Command Palette (Hidden/Show Rust Modules Files).

## 🛠 Installation

1. Open VSCode and go to Extensions.

2. Search for Rust Automod.

3. Install and reload VSCode.

## 📌 Usage

1. Create a Rust project or open an existing one in VSCode.

2. Optionally, add a `.rautomod` file at the root with your desired settings.

3. Create a new Rust file inside any folder:
    - Automod will create or update `mod.rs`.
    - The new module will be added automatically.

4. Delete a Rust file:
    - Automod will remove the module declaration from `mod.rs`.

5. Use autocomplete and linting when editing `.rautomod` to ensure correct configuration.

# 💡 Notes

- **Formatting Prerequisite**: For `fmt=enabled` to work, `rustfmt` must be installed (`rustup component add rustfmt`) and the `cargo` command must be available in your system's PATH.

- If no `.rautomod` file is found, Automod will fallback to the global VSCode settings (`rustautomod.visibility`, `rustautomod.sort`, and `rustautomod.fmt`), defaulting to pub, none, and disabled.

- Nested folders are supported; Automod will create `mod.rs` files recursively as needed.

- `pattern` rules allow per-folder or per-file customization for all settings.

## 🤝 Contribution

Contributions, issues, and feature requests are welcome!
