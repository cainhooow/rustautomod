# Rust Automod

Rust Automod is a Visual Studio Code extension that automates the management of mod.rs files in Rust projects. It eliminates the repetitive task of manually creating and maintaining module declarations, keeping your Rust project structure clean and organized.

## 🚀 What It Solves

- In Rust, a folder without a mod.rs file is not automatically recognized as a module. This can lead to tedious manual work when creating new files or folders. Rust Automod automates this by:

- Automatically creating a mod.rs file when a new Rust file is added to a folder.

- Adding new module declarations (mod or pub mod) in the mod.rs file automatically.

- Creating mod.rs in nested folders and updating the parent module automatically.

- Removing module declarations when a Rust file is deleted.

- Ensuring modules are sorted alphabetically (optional) and avoiding duplicates.

- Supporting project-specific configuration through a .rautomod file.

## 📁 .rautomod Configuration

You can place a .rautomod file in the root of your Rust project (or any folder) to customize Automod behavior. The available configuration options are:

```
visibility=pub      # 'pub' for public modules (pub mod), 'private' for private modules (mod)
sort=alpha          # 'alpha' to sort module declarations alphabetically, 'none' to preserve insertion order
```

### Example .rautomod:
```
visibility=pub
sort=alpha
```

This configuration will create all module declarations as pub mod and sort them alphabetically in mod.rs files.

## ⚡ Features

- Automatic mod.rs creation: No need to manually create mod.rs when adding a new Rust file.

- Automatic module registration: Updates parent mod.rs and child folders automatically.

- Deletion support: Removes module declarations when files are deleted.

- Project-specific configuration: .rautomod allows different settings per project.

- Optional sorting: Alphabetical ordering of module declarations.

- IntelliSense support: Autocomplete for .rautomod keys (visibility, sort) and values (pub, private, alpha, none).

- Linting: .rautomod is validated with inline errors in VSCode.

## 🛠 Installation

1. Open VSCode and go to Extensions.

2. Search for Rust Automod.

3. Install and reload VSCode.

## 📌 Usage

1. Create a Rust project or open an existing one in VSCode.

2. Optionally, add a .rautomod file at the root with your desired settings.

3. Create a new Rust file inside any folder:

   - Automod will create or update mod.rs.

   - The new module will be added automatically.

4. Delete a Rust file:
   - Automod will remove the module declaration from mod.rs.

5.  Use autocomplete and linting when editing .rautomod to ensure correct configuration.

## 💡 Notes

- If no .rautomod file is found, Automod will fallback to the global VSCode settings (rustautomod.visibility and rustautomod.sort), defaulting to pub and none.

- Nested folders are supported; Automod will create mod.rs files recursively as needed.

## 🤝 Contribution

Contributions, issues, and feature requests are welcome!