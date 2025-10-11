# Change Log

## [released]

### 1.1.9
Critical: Fixed extension modifying mod.rs files during git operations (rebases, branch switches, merges)

Previously, rapid file changes during git operations would trigger immediate processing for each file
This caused race conditions and unwanted modifications while git was still working
Issue reported by users experiencing corrupted module declarations after git operations

### 1.1.7 
Fix: The extension is treating an internal module (with body {...}) as if it were an external module declaration (which points to a file), causing it to be moved incorrectly by the sort function.

### 1.1.5 
Fix for build.rs files

### 1.1.3 - 1.1.4
This version introduces powerful new features for handling complex Rust projects and fixes major bugs related to module sorting and the handling of conditionally compiled modules.

## Added
- **Conditional Compilation Support via** `.rautomod`:
It is now possible to add the `cfg` key in the `.rautomod` file to automatically generate module declarations with `#[cfg(...)]` attributes. The feature supports multiple, complex, comma-separated conditions for advanced scenarios (e.g., `cfg=feature="serde"`, `all(unix, target_pointer_width="64")`).

- **Automatic Formatting with** `cargo fmt`:
A new `fmt=enabled` key has been added to `.rautomod.` When enabled, the extension will automatically run `cargo fmt` after creating or deleting modules, ensuring the generated code always follows the project's style. (Requires `rustfmt` to be installed via `rustup component add rustfmt`).

## Fixed

- **New Module Positioning**:
Fixed a critical bug where new module declarations were inserted at the top of the file, often breaking the order of `use` statements, especially when the sorting option (`sort=alpha`) was active. The original position of the module block is now always preserved.

- **Handling of Modules with Multiple** `#[cfg]` **Attributes**:
Resolved an issue where deleting a file that had multiple conditional declarations (e.g., one for Windows and another for Unix) would only remove the first instance, leaving behind orphan declarations and breaking the build.

- **Parsing of Complex** `cfg` **Configurations**:
The `.rautomod` parser has been made more robust to correctly handle complex values in the `cfg` key that contain equal signs (`=`) and commas inside parentheses, such as in `all(...)`.

### 1.1.2

- Fix issue when a mod.rs related file was deleted, all spaces in mod.rs were removed
- Also fixed when when changing branches, blank lines were deleted, the same problem as question 1;

**Any contribution for new improvements and features will be welcome.**

### 1.1.0

- `.rautomod` now supports the pattern option to apply visibility and sorting rules only to specific files or folders.

- Advanced configuration allows multiple patterns (comma-separated) per rule.

- Updated `.rautomod` validator and autocomplete to support `pattern`.

- Examples and documentation added for basic and advanced `.rautomod` usage.

- IntelliSense now suggests pattern and example values for easier configuration.

**Fixed**
- Parser bug that ignored rules in `.rautomod` with patterns.
- Sorting and visibility now correctly respect `.rautomod` rules.

### 1.0.8

- **Hide/Show mod.rs files**: Quickly toggle the visibility of all mod.rs files via the Command Palette (`Hidden/Show Rust Modules Files`)
