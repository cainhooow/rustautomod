import vscode from "vscode";
import path from "path";
import { promises as fs } from "fs";
import { AutomodVisibility } from "../../interfaces/automodconf";
import { buildModDeclarations } from "../modDeclarations";
import { updateModuleVisibility } from "../modContentEditor";
import {
    detectRustModuleLayout,
    fileExists,
    isModulePairRegistrationFile,
    resolveRootModuleRegistrationFile
} from "../modFileSystem";
import {
    ensureTrailingNewline,
    buildScaffoldContent,
    normalizePath,
    pickVisibility,
    readTextFileIfExists,
    resolveDeclarationTargetForModule,
    resolveFolderResourceUri,
    resolveModuleRegistrationFile,
    resolveModuleSourceUri,
    resolveProjectConfigAsync,
    resolveResourceUri,
    resolveTargetFilePath,
    showMarkdownDocument,
    writeTextFile
} from "./automodUtilities";
import { applyPlannedBatch, getAutomodRuntime } from "./automodRuntimeContext";
import {
    planEnsureModuleRegistered,
    planFileDelete,
    planFileRename,
    planNewFile,
    planScopeOperation
} from "./automodPlanner";

export async function handleNewFile(uri: vscode.Uri): Promise<void> {
    const batch = await planNewFile(uri);
    await applyPlannedBatch(batch);
}

export async function handleFileRename(oldUri: vscode.Uri, newUri: vscode.Uri): Promise<void> {
    const batch = await planFileRename(oldUri, newUri);
    await applyPlannedBatch(batch);
}

export async function handleFileDelete(uri: vscode.Uri): Promise<void> {
    const batch = await planFileDelete(uri);
    await applyPlannedBatch(batch);
}

export async function previewAutomod(resource?: vscode.Uri): Promise<void> {
    const batch = await planScopeOperation(resource);
    await getAutomodRuntime().previewBatch(batch);
}

export async function regenerateModules(resource?: vscode.Uri, previewOnly = false): Promise<void> {
    const batch = await planScopeOperation(resource);
    if (previewOnly) {
        await getAutomodRuntime().previewBatch(batch);
        return;
    }

    await applyPlannedBatch(batch);
}

export async function undoLastAutomodAction(): Promise<void> {
    await getAutomodRuntime().undoLast();
}

export function openAutomodLog(): void {
    getAutomodRuntime().showLog();
}

export async function showEffectiveConfig(resource?: vscode.Uri): Promise<void> {
    const target = await resolveResourceUri(resource);
    if (!target) {
        vscode.window.showInformationMessage("Select a Rust file to inspect the effective Rust AutoMod config.");
        return;
    }

    const resolved = await resolveProjectConfigAsync(target.fsPath);
    const content = [
        "# Effective Rust AutoMod Config",
        "",
        `- File: \`${target.fsPath}\``,
        `- Config source: \`${resolved.sourcePath ?? "VS Code settings"}\``,
        `- Rule index: ${resolved.matchedRuleIndex >= 0 ? resolved.matchedRuleIndex : "default"}`,
        `- Matched patterns: ${resolved.matchedPatterns.length > 0 ? resolved.matchedPatterns.join(", ") : "default rule"}`,
        `- Ignored: ${resolved.ignored ? "yes" : "no"}`,
        `- Schema version: ${resolved.schemaVersion}`,
        `- Strict mode: ${resolved.strictMode}`,
        "",
        "```json",
        JSON.stringify(resolved.rule, null, 2),
        "```",
        "",
        "Diagnostics:",
        resolved.diagnostics.length > 0
            ? resolved.diagnostics.map(diagnostic => `- [${diagnostic.severity}] line ${diagnostic.line + 1}: ${diagnostic.message}`).join("\n")
            : "- none"
    ].join("\n");

    await showMarkdownDocument(content);
}

export async function explainAutomod(resource?: vscode.Uri): Promise<void> {
    const target = await resolveResourceUri(resource);
    if (!target) {
        vscode.window.showInformationMessage("Select a Rust file to explain how Rust AutoMod will handle it.");
        return;
    }

    const filePath = target.fsPath;
    const resolved = await resolveProjectConfigAsync(filePath);
    const targetFilePath = await resolveTargetFilePath(path.dirname(filePath), resolved);
    const moduleName = path.basename(filePath, ".rs");
    const previewLines = buildModDeclarations(moduleName, resolved.rule);
    const content = [
        "# Why Rust AutoMod Chose This",
        "",
        `- Source file: \`${filePath}\``,
        `- Registration target: \`${targetFilePath ?? "no target available"}\``,
        `- Ignored by config: ${resolved.ignored ? "yes" : "no"}`,
        `- Sort mode: \`${resolved.rule.sort}\``,
        `- Visibility: \`${resolved.rule.visibility}\``,
        `- Reexport: \`${resolved.rule.reexport ?? "disabled"}\``,
        `- Group order: \`${(resolved.rule.groupOrder ?? []).join(", ")}\``,
        `- Blank lines between groups: ${resolved.rule.blankLines ?? 1}`,
        "",
        "Preview of generated lines:",
        "```rust",
        previewLines.join("\n"),
        "```"
    ].join("\n");

    await showMarkdownDocument(content);
}

export async function ignorePathInRautomod(resource?: vscode.Uri): Promise<void> {
    const target = resource ?? vscode.window.activeTextEditor?.document.uri;
    if (!target) {
        vscode.window.showInformationMessage("Select a file or folder to ignore in .rautomod.");
        return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(target);
    if (!workspaceFolder) {
        vscode.window.showInformationMessage("Rust AutoMod can only ignore paths inside a workspace folder.");
        return;
    }

    const configPath = path.join(workspaceFolder.uri.fsPath, ".rautomod");
    const content = await readTextFileIfExists(configPath) ?? "";
    const relativePath = normalizePath(path.relative(workspaceFolder.uri.fsPath, target.fsPath));
    const pattern = (await fs.stat(target.fsPath)).isDirectory() ? `${relativePath}/**` : relativePath;
    const ignoreBlock = `exclude=${pattern}`;

    if (content.includes(ignoreBlock)) {
        vscode.window.showInformationMessage(`'${pattern}' is already ignored by Rust AutoMod.`);
        return;
    }

    const nextContent = content.trim()
        ? `${ignoreBlock}\n\n${content}`
        : `${ignoreBlock}\n`;
    await writeTextFile(configPath, nextContent);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(configPath));
}

export async function scaffoldRautomod(resource?: vscode.Uri): Promise<void> {
    const workspaceFolder = resource
        ? vscode.workspace.getWorkspaceFolder(resource)
        : vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) {
        vscode.window.showInformationMessage("Open a workspace folder before scaffolding .rautomod.");
        return;
    }

    const configPath = path.join(workspaceFolder.uri.fsPath, ".rautomod");
    if (!await fileExists(configPath)) {
        await writeTextFile(configPath, buildScaffoldContent());
    }

    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(configPath));
}

export async function createModulePair(resource?: vscode.Uri): Promise<void> {
    const baseFolderUri = await resolveFolderResourceUri(resource);
    if (!baseFolderUri) {
        vscode.window.showInformationMessage("Select a folder or Rust file before creating a module pair.");
        return;
    }

    const moduleName = await vscode.window.showInputBox({
        prompt: "Rust module name",
        placeHolder: "orders",
        validateInput(value) {
            return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value.trim())
                ? null
                : "Use a valid Rust module identifier.";
        }
    });

    if (!moduleName) {
        return;
    }

    const visibility = await pickVisibility();
    if (!visibility) {
        return;
    }

    const moduleLayout = await detectRustModuleLayout(baseFolderUri.fsPath);
    const moduleFolderPath = path.join(baseFolderUri.fsPath, moduleName);
    const moduleFilePath = moduleLayout === "modern"
        ? path.join(baseFolderUri.fsPath, `${moduleName}.rs`)
        : path.join(moduleFolderPath, "mod.rs");

    if (await fileExists(moduleFilePath)) {
        vscode.window.showWarningMessage(`Rust AutoMod found an existing module file at ${moduleFilePath}.`);
        return;
    }

    await fs.mkdir(moduleFolderPath, { recursive: true });
    await writeTextFile(moduleFilePath, "");

    const parentConfig = await resolveProjectConfigAsync(moduleFilePath);
    const parentTarget = await resolveModuleRegistrationFile(baseFolderUri.fsPath);
    if (parentTarget) {
        const change = await planEnsureModuleRegistered(
            parentTarget,
            moduleName,
            {
                ...parentConfig.rule,
                visibility
            },
            moduleLayout === "modern"
                ? "Register new modern module pair"
                : "Register new folder module"
        );

        if (change) {
            await applyPlannedBatch({
                label: "Create module pair",
                sourcePath: moduleFilePath,
                changes: [change]
            });
        }
    }

    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(moduleFilePath));
}

export async function setModuleVisibility(
    resource?: vscode.Uri,
    desiredVisibility?: AutomodVisibility
): Promise<void> {
    const target = await resolveModuleSourceUri(resource);
    if (!target) {
        vscode.window.showInformationMessage("Select a Rust module file before changing visibility.");
        return;
    }

    const visibility = desiredVisibility ?? await pickVisibility();
    if (!visibility) {
        return;
    }

    const descriptor = await resolveDeclarationTargetForModule(target.fsPath);
    if (!descriptor) {
        vscode.window.showWarningMessage("Rust AutoMod could not find the declaration target for this module.");
        return;
    }

    const beforeContent = await readTextFileIfExists(descriptor.targetFilePath);
    if (beforeContent === null) {
        vscode.window.showWarningMessage("Rust AutoMod could not read the file that declares this module.");
        return;
    }

    const afterContent = updateModuleVisibility(beforeContent, descriptor.moduleName, visibility);
    if (afterContent === beforeContent) {
        vscode.window.showInformationMessage(`The module '${descriptor.moduleName}' is already ${visibility}.`);
        return;
    }

    await applyPlannedBatch({
        label: "Change module visibility",
        sourcePath: target.fsPath,
        changes: [{
            targetFilePath: descriptor.targetFilePath,
            beforeContent,
            afterContent: ensureTrailingNewline(afterContent),
            reason: `Set module visibility to ${visibility}`,
            formatAfterApply: false
        }]
    });
}

export async function moveModuleToCrateRoot(resource?: vscode.Uri): Promise<void> {
    const target = await resolveModuleSourceUri(resource);
    if (!target) {
        vscode.window.showInformationMessage("Select a leaf Rust module file before moving it to the crate root.");
        return;
    }

    const targetBaseName = path.basename(target.fsPath);
    if (targetBaseName === "mod.rs" || await isModulePairRegistrationFile(target.fsPath)) {
        vscode.window.showInformationMessage("Move to Crate Root currently supports leaf module files, not folder roots or module pairs.");
        return;
    }

    const crateRootRegistration = await resolveRootModuleRegistrationFile(path.dirname(target.fsPath));
    if (!crateRootRegistration) {
        vscode.window.showInformationMessage("Rust AutoMod could not find lib.rs or main.rs for this module.");
        return;
    }

    const destinationPath = path.join(path.dirname(crateRootRegistration), path.basename(target.fsPath));
    if (path.normalize(destinationPath) === path.normalize(target.fsPath)) {
        vscode.window.showInformationMessage("This module is already at the crate root.");
        return;
    }

    if (await fileExists(destinationPath)) {
        vscode.window.showWarningMessage(`A file named ${path.basename(destinationPath)} already exists at the crate root.`);
        return;
    }

    await fs.rename(target.fsPath, destinationPath);
    await regenerateModules(vscode.Uri.file(path.dirname(crateRootRegistration)));
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(destinationPath));
}
