import vscode from "vscode";
import path from "path";
import fs from "fs";
import { getProjectConfig } from "./automodConfigFile";
import { ModDeclaration } from "../interfaces/modeclaration";
import { exec } from "child_process";

/**
 * Finds the project root by searching for a `Cargo.toml` file, starting from a given path and moving upwards.
 * @param {string} startPath - The initial path to start the search from.
 * @returns {string | null} The path to the project root if found, otherwise null.
 */
function findProjectRoot(startPath: string): string | null {
    let currentPath = startPath;
    while (currentPath !== path.dirname(currentPath)) {
        if (fs.existsSync(path.join(currentPath, "Cargo.toml"))) {
            return currentPath;
        }
        currentPath = path.dirname(currentPath);
    }
    return null;
}

/**
 * Runs `cargo fmt` in the project root of the given file path.
 * Displays an error message if `cargo fmt` fails.
 * @param {string} filePath - The path of the file that triggered the formatting.
 * @returns {Promise<void>}
 */
async function runCargoFmt(filePath: string): Promise<void> {
    const projectRoot = findProjectRoot(filePath);
    if (!projectRoot) {
        console.log("RUST AUTOMOD: Cargo.toml not found. Skipping 'cargo fmt'.");
        return;
    }

    exec("cargo fmt", { cwd: projectRoot }, (error, stdout, stderr) => {
        if (error) {
            vscode.window.showErrorMessage(`Failed to run 'cargo fmt': ${stderr}`);
            console.error(`RUST AUTOMOD 'cargo fmt' error: ${stderr}`);
            return;
        }
        console.log(`RUST AUTOMOD: 'cargo fmt' executed successfully in ${projectRoot}.`);
    });
}

/**
 * Generates the appropriate module declaration lines based on the project's configuration.
 * It considers visibility (`pub` or `private`) and conditional compilation flags (`cfg`).
 * @param {string} name - The name of the module.
 * @param {string} filePath - The file path to determine the relevant configuration.
 * @returns {string[]} An array of strings representing the full module declaration.
 */
function getModDeclarations(name: string, filePath: string): string[] {
    const config = getProjectConfig(filePath);
    const visibility = config.visibility === "private" ? "mod" : "pub mod";
    const modLine = `${visibility} ${name};`;

    // If no cfg attributes are present, return the simple module line.
    if (!config.cfg || config.cfg.length === 0) {
        return [modLine];
    }

    // If cfg attributes are present, generate a declaration for each condition.
    return config.cfg.flatMap(condition => {
        return [`#[cfg(${condition})]`, modLine];
    });
}

/**
 * Parses the content of a `mod.rs` or `lib.rs`/`main.rs` file to find all external module declarations.
 * It correctly identifies `mod` declarations that end with a semicolon, ignoring inline modules with a body (`{...}`).
 * It also captures any associated attributes like `#[cfg(...)]`.
 * @param {string[]} lines - An array of strings representing the lines of the file.
 * @returns {ModDeclaration[]} An array of objects, each representing a module declaration.
 */
function parseModDeclarations(lines: string[]): ModDeclaration[] {
    const modDeclarations: ModDeclaration[] = [];

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        // Remove comments to analyze only the code instruction.
        const instructionOnly = trimmed.split("//")[0].trim();

        // Ensure it's an external module declaration (ends with ';').
        if ((instructionOnly.startsWith('mod ') || instructionOnly.startsWith('pub mod ')) && instructionOnly.endsWith(';')) {
            const attributes: string[] = [];
            const fullBlock: string[] = [];
            let startIndex = i;

            // Look backwards for attributes associated with the module.
            let j = i - 1;
            while (j >= 0) {
                const prevTrimmed = lines[j].trim();
                if (prevTrimmed.startsWith('#[') || prevTrimmed.startsWith('#!')) {
                    attributes.unshift(lines[j]);
                    fullBlock.unshift(lines[j]);
                    startIndex = j;
                    j--;
                } else if (prevTrimmed === "" || prevTrimmed.startsWith("//")) {
                    j--; // Skip empty lines and comments.
                } else {
                    break;
                }
            }

            fullBlock.push(lines[i]);

            modDeclarations.push({
                attributes,
                modLine: lines[i],
                fullBlock,
                startIndex,
                endIndex: i
            });
        }
    }

    return modDeclarations;
}

/**
 * Extracts the module name from a module declaration line.
 * e.g., "pub mod my_module;" -> "my_module"
 * @param {string} modLine - The string containing the module declaration.
 * @returns {string} The extracted module name.
 */
function extractModuleName(modLine: string): string {
    const match = modLine.match(/(?:pub\s+)?mod\s+(\w+)/);
    return match ? match[1] : "";
}

/**
 * Finds the ideal insertion point for a new module declaration in a file.
 * It aims to place it after header comments and `use` statements.
 * @param {string[]} lines - The lines of the file content.
 * @returns {number} The line number where the new module should be inserted.
 */
function findInsertionPoint(lines: string[]): number {
    let afterHeaderIndex = 0;

    // Skip over file-level comments and attributes.
    while (
        afterHeaderIndex < lines.length &&
        (lines[afterHeaderIndex].trim().startsWith("//!") ||
            lines[afterHeaderIndex].trim().startsWith("/*!") ||
            lines[afterHeaderIndex].trim().startsWith("#!") ||
            lines[afterHeaderIndex].trim() === "")
    ) {
        afterHeaderIndex++;
    }

    let useBlockEnd = -1;
    let braceDepth = 0;
    let inUseStatement = false;

    // Find the end of the `use` statements block.
    for (let i = afterHeaderIndex; i < lines.length; i++) {
        const trimmed = lines[i].trim();

        if (trimmed.startsWith("use ")) {
            inUseStatement = true;
            braceDepth = 0;
            for (const char of trimmed) {
                if (char === '{') braceDepth++;
                else if (char === '}') braceDepth--;
            }

            if (trimmed.endsWith(";") && braceDepth === 0) {
                useBlockEnd = i;
                inUseStatement = false;
            }
        } else if (inUseStatement) {
            for (const char of trimmed) {
                if (char === '{') braceDepth++;
                else if (char === '}') braceDepth--;
            }

            if (trimmed.endsWith(";") && braceDepth === 0) {
                useBlockEnd = i;
                inUseStatement = false;
            }
        } else if (trimmed !== "" &&
            !trimmed.startsWith("//") &&
            !trimmed.startsWith("/*")) {
            break; // Stop at the first non-use, non-comment line.
        }
    }

    if (useBlockEnd >= 0) {
        let insertIndex = useBlockEnd + 1;
        // Skip any blank lines after the `use` block.
        while (insertIndex < lines.length && lines[insertIndex].trim() === "") {
            insertIndex++;
        }
        return insertIndex;
    } else {
        return afterHeaderIndex;
    }
}

/**
 * Adds a new module declaration to the file content.
 * It finds the correct insertion point and optionally sorts the declarations.
 * @param {string} content - The original file content.
 * @param {string[]} newLines - The new module declaration lines to add.
 * @param {string} filePath - The path of the file being modified.
 * @returns {string} The updated file content.
 */
function addModLine(content: string, newLines: string[], filePath: string): string {
    const config = getProjectConfig(filePath);
    const lines = content.split(/\r?\n/);

    const existingMods = parseModDeclarations(lines);
    const modLine = newLines.find(line => line.includes("mod ")) || "";
    const newModuleName = extractModuleName(modLine);

    // Avoid adding a duplicate module declaration.
    if (newModuleName) {
        const existingInstances = existingMods.filter(mod =>
            extractModuleName(mod.modLine) === newModuleName
        );
        if (existingInstances.length > 0) {
            return content;
        }
    }

    let insertIndex = -1;

    if (existingMods.length > 0) {
        // Insert after the last existing module declaration.
        const lastMod = existingMods[existingMods.length - 1];
        insertIndex = lastMod.endIndex + 1;
    } else {
        // Find the best insertion point if no modules exist yet.
        insertIndex = findInsertionPoint(lines);
    }

    // Add a blank line for separation if needed.
    if (insertIndex > 0 &&
        lines[insertIndex - 1].trim() !== "" &&
        !lines[insertIndex - 1].trim().startsWith("use ")) {
        lines.splice(insertIndex, 0, "");
        insertIndex++;
    }

    lines.splice(insertIndex, 0, ...newLines);

    if (config.sort === "alpha") {
        sortModDeclarations(lines);
    }

    const result = lines.join("\n");
    return content.endsWith("\n") ? result + "\n" : result;
}

/**
 * Sorts all module declarations in the file alphabetically.
 * It preserves the original block position of the declarations.
 * @param {string[]} lines - The array of file lines, which will be modified in place.
 */
function sortModDeclarations(lines: string[]): void {
    const modDeclarations = parseModDeclarations(lines);

    if (modDeclarations.length <= 1) {
        return;
    }

    // The entire block of modules will be re-inserted at the start of the first module.
    const insertionIndex = modDeclarations[0].startIndex;

    const sortedDeclarations = [...modDeclarations].sort((a, b) => {
        const nameA = extractModuleName(a.modLine);
        const nameB = extractModuleName(b.modLine);
        return nameA.localeCompare(nameB);
    });

    // Remove the old (unsorted) declarations from the lines array.
    for (let i = modDeclarations.length - 1; i >= 0; i--) {
        const decl = modDeclarations[i];
        const removeCount = decl.endIndex - decl.startIndex + 1;
        lines.splice(decl.startIndex, removeCount);
    }

    const newBlockContent = sortedDeclarations.flatMap(decl => decl.fullBlock);

    // Insert the new, sorted block of module declarations.
    lines.splice(insertionIndex, 0, ...newBlockContent);
}

/**
 * Handles the logic for when a new Rust file is created.
 * It updates or creates the relevant `mod.rs`, `lib.rs`, or `main.rs`.
 * @param {vscode.Uri} uri - The URI of the newly created file.
 */
export async function handleNewFile(uri: vscode.Uri) {
    const filePath = uri.fsPath;
    const folderPath = path.dirname(filePath);
    const fileName = path.basename(filePath, ".rs");

    // Ignore special Rust files like `mod`, `lib`, `main`, or `build`.
    const fileNameMatch: Record<string, boolean> = {
        mod: fileName === "mod",
        lib: fileName === "lib",
        main: fileName === "main",
        build: fileName === "build"
    };

    if (fileNameMatch[fileName]) return;

    const config = getProjectConfig(filePath);
    const libRsPath = path.join(folderPath, "lib.rs");
    const mainRsPath = path.join(folderPath, "main.rs");

    // Handle module registration in `lib.rs` or `main.rs` if they exist.
    if (fs.existsSync(libRsPath) || fs.existsSync(mainRsPath)) {
        const rootFilePath = fs.existsSync(libRsPath) ? libRsPath : mainRsPath;
        const newModLines = getModDeclarations(fileName, filePath);
        let content = fs.readFileSync(rootFilePath, "utf-8");
        const updatedContent = addModLine(content, newModLines, filePath);
        if (updatedContent !== content) {
            fs.writeFileSync(rootFilePath, updatedContent);
            if (config.fmt === "enabled") { await runCargoFmt(rootFilePath); }
        }
        return;
    }

    // Handle module registration in `mod.rs`.
    const modFilePath = path.join(folderPath, "mod.rs");
    if (!fs.existsSync(modFilePath)) {
        // Create `mod.rs` if it doesn't exist.
        const newModLines = getModDeclarations(fileName, filePath);
        fs.writeFileSync(modFilePath, newModLines.join("\n") + "\n");
        if (config.fmt === "enabled") { await runCargoFmt(modFilePath); }
    } else {
        // Update `mod.rs` if it already exists.
        let content = fs.readFileSync(modFilePath, "utf-8");
        const newModLines = getModDeclarations(fileName, filePath);
        const updatedContent = addModLine(content, newModLines, filePath);
        if (updatedContent !== content) {
            fs.writeFileSync(modFilePath, updatedContent);
            if (config.fmt === "enabled") { await runCargoFmt(modFilePath); }
        }
    }

    // Recursively register the new module in the parent directory's `mod.rs`.
    const parentDir = path.dirname(folderPath);
    const parentMod = path.join(parentDir, "mod.rs");
    const folderName = path.basename(folderPath);

    if (fs.existsSync(parentMod)) {
        let parentContent = fs.readFileSync(parentMod, "utf-8");
        const newParentModLines = getModDeclarations(folderName, parentMod);
        const updatedContent = addModLine(parentContent, newParentModLines, parentMod);
        if (updatedContent !== parentContent) {
            fs.writeFileSync(parentMod, updatedContent);
            if (config.fmt === "enabled") { await runCargoFmt(parentMod); }
        }
    }
}

/**
 * Handles the logic for when a Rust file is renamed.
 * This function waits for Rust Analyzer to update the module declaration,
 * then optionally sorts the declarations alphabetically if configured.
 * @param {vscode.Uri} oldUri - The URI of the old file path.
 * @param {vscode.Uri} newUri - The URI of the new file path.
 */
export async function handleFileRename(oldUri: vscode.Uri, newUri: vscode.Uri) {
    const oldFilePath = oldUri.fsPath;
    const newFilePath = newUri.fsPath;
    const oldFileName = path.basename(oldFilePath, ".rs");
    const newFileName = path.basename(newFilePath, ".rs");
    const folderPath = path.dirname(newFilePath);

    // Ignore special Rust files
    const fileNameMatch: Record<string, boolean> = {
        mod: oldFileName === "mod" || newFileName === "mod",
        lib: oldFileName === "lib" || newFileName === "lib",
        main: oldFileName === "main" || newFileName === "main",
        build: oldFileName === "build" || newFileName === "build"
    };

    if (fileNameMatch[oldFileName] || fileNameMatch[newFileName]) return;

    const config = getProjectConfig(newFilePath);

    // Find the mod file (lib.rs, main.rs, or mod.rs)
    const libRsPath = path.join(folderPath, "lib.rs");
    const mainRsPath = path.join(folderPath, "main.rs");
    const modFilePath = path.join(folderPath, "mod.rs");

    let targetFilePath = null;
    if (fs.existsSync(libRsPath)) targetFilePath = libRsPath;
    else if (fs.existsSync(mainRsPath)) targetFilePath = mainRsPath;
    else if (fs.existsSync(modFilePath)) targetFilePath = modFilePath;

    if (!targetFilePath) return;

    // Wait a bit for Rust Analyzer to finish its work
    await new Promise(resolve => setTimeout(resolve, 200));

    // Read the file after R.A. has done its work
    let content = fs.readFileSync(targetFilePath, "utf-8");
    const lines = content.split(/\r?\n/);

    // Only sort if configured to do so
    if (config.sort === "alpha") {
        console.log(`RUST AUTOMOD: Sorting module declarations in ${targetFilePath} after rename`);
        sortModDeclarations(lines);

        const newContent = lines.join("\n");
        const finalContent = content.endsWith("\n") ? newContent + "\n" : newContent;

        if (finalContent !== content) {
            fs.writeFileSync(targetFilePath, finalContent);
            if (config.fmt === "enabled") {
                await runCargoFmt(targetFilePath);
            }
        }
    }
}

/**
 * Handles the logic for when a Rust file is deleted.
 * It removes the corresponding module declaration from `mod.rs`, `lib.rs`, or `main.rs`.
 * @param {vscode.Uri} uri - The URI of the deleted file.
 */
export async function handleFileDelete(uri: vscode.Uri) {
    const filePath = uri.fsPath;
    const folderPath = path.dirname(filePath);
    const fileName = path.basename(filePath, ".rs");

    // Ignore special Rust files.
    const fileNameMatch: Record<string, boolean> = {
        mod: fileName === "mod",
        lib: fileName === "lib",
        main: fileName === "main",
        build: fileName === "build"
    };

    if (fileNameMatch[fileName]) return;

    const config = getProjectConfig(filePath);
    const libRsPath = path.join(folderPath, "lib.rs");
    const mainRsPath = path.join(folderPath, "main.rs");
    const modFilePath = path.join(folderPath, "mod.rs");

    let targetFilePath = null;
    if (fs.existsSync(libRsPath)) targetFilePath = libRsPath;
    else if (fs.existsSync(mainRsPath)) targetFilePath = mainRsPath;
    else if (fs.existsSync(modFilePath)) targetFilePath = modFilePath;

    if (!targetFilePath) return;

    let content = fs.readFileSync(targetFilePath, "utf-8");
    const lines = content.split(/\r?\n/);

    const modDeclarations = parseModDeclarations(lines);
    const targetModuleName = fileName;

    // Find all declarations matching the deleted file's name.
    const modsToRemove = modDeclarations.filter(mod =>
        extractModuleName(mod.modLine) === targetModuleName
    );

    if (modsToRemove.length > 0) {
        // Remove the declarations from the lines array.
        for (let i = modsToRemove.length - 1; i >= 0; i--) {
            const modToRemove = modsToRemove[i];
            const removeCount = modToRemove.endIndex - modToRemove.startIndex + 1;
            lines.splice(modToRemove.startIndex, removeCount);
        }

        const newContent = lines.join("\n");
        const finalContent = content.endsWith("\n") ? newContent + "\n" : newContent;
        fs.writeFileSync(targetFilePath, finalContent);
        if (config.fmt === "enabled") { await runCargoFmt(targetFilePath); }
    }
}