# Change Log

## [released]

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
