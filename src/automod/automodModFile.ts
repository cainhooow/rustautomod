import vscode from "vscode";
import path from "path";
import { promises as fs } from "fs";
import {
    AutomodVisibility,
    AutomodRule,
    ResolvedAutomodConfig
} from "../interfaces/automodconf";
import { AutomodFileChange, AutomodOperationBatch } from "../interfaces/automodoperation";
import { getPathRejectionReason, isValidRustPath, isBlacklistedPath } from "../utils/pathValidator";
import {
    getProjectConfigAsync,
    resolveProjectConfigAsync
} from "./automodConfigFile";
import {
    addModDeclarations,
    removeModDeclarations,
    sortModDeclarationsInContent,
    updateModuleVisibility
} from "./modContentEditor";
import { buildModDeclarations, parseModDeclarations } from "./modDeclarations";
import {
    detectRustModuleLayout,
    fileExists,
    isModulePairRegistrationFile,
    listDirectoriesRecursively,
    listImmediateModuleFolders,
    listImmediateRustModules,
    readTextFileIfExists,
    resolveModuleRegistrationFile,
    resolveModuleRegistrationTarget,
    resolveModuleRegistrationFileForTarget,
    resolveRootModuleRegistrationFile,
    resolveSourceDirectoryForRegistrationFile,
    writeTextFile
} from "./modFileSystem";
import { AutomodRuntime } from "./automodRuntime";

let runtime: AutomodRuntime | null = null;

export function configureAutomodRuntime(nextRuntime: AutomodRuntime): void {
    runtime = nextRuntime;
}

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
    const batch = await planScopeOperation(resource, true);
    await getRuntime().previewBatch(batch);
}

export async function regenerateModules(resource?: vscode.Uri, previewOnly = false): Promise<void> {
    const batch = await planScopeOperation(resource, false);
    if (previewOnly) {
        await getRuntime().previewBatch(batch);
        return;
    }

    await applyPlannedBatch(batch);
}

export async function undoLastAutomodAction(): Promise<void> {
    await getRuntime().undoLast();
}

export function openAutomodLog(): void {
    getRuntime().showLog();
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
    const pattern = await isDirectory(target.fsPath) ? `${relativePath}/**` : relativePath;
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

export async function planNewFile(uri: vscode.Uri): Promise<AutomodOperationBatch> {
    const filePath = uri.fsPath;
    if (!validateRustFileOperation(filePath, "creation")) {
        return createEmptyBatch("File create", filePath);
    }

    const folderPath = path.dirname(filePath);
    const fileName = path.basename(filePath, ".rs");
    if (isSpecialRustFile(fileName)) {
        return createEmptyBatch("File create", filePath);
    }

    const resolvedConfig = await resolveProjectConfigAsync(filePath);
    if (shouldSkipByResolvedConfig(resolvedConfig)) {
        return createEmptyBatch("File create", filePath);
    }

    const changes: AutomodFileChange[] = [];
    const targetRegistration = await resolveTargetRegistration(folderPath, resolvedConfig);
    if (targetRegistration) {
        const change = await planEnsureModuleRegistered(targetRegistration.filePath, fileName, resolvedConfig.rule, "Register module");
        if (change) {
            changes.push(change);
        }
    }

    if (targetRegistration && targetRegistration.kind !== "crate_root") {
        const parentTargetFilePath = await resolveModuleRegistrationFile(path.dirname(folderPath));
        if (parentTargetFilePath) {
            const parentModuleConfig = await getProjectConfigAsync(targetRegistration.filePath);
            const parentChange = await planEnsureModuleRegistered(
                parentTargetFilePath,
                path.basename(folderPath),
                parentModuleConfig,
                targetRegistration.kind === "modern"
                    ? "Register modern child module"
                    : "Register child module folder"
            );
            if (parentChange) {
                changes.push(parentChange);
            }
        }
    }

    return {
        label: "File create",
        sourcePath: filePath,
        changes: mergeChangesByTarget(changes)
    };
}

export async function planFileDelete(uri: vscode.Uri): Promise<AutomodOperationBatch> {
    const filePath = uri.fsPath;
    if (!validateRustFileOperation(filePath, "deletion")) {
        return createEmptyBatch("File delete", filePath);
    }

    const folderPath = path.dirname(filePath);
    const fileName = path.basename(filePath, ".rs");
    if (isSpecialRustFile(fileName)) {
        return createEmptyBatch("File delete", filePath);
    }

    const resolvedConfig = await resolveProjectConfigAsync(filePath);
    const targetFilePath = await resolveTargetFilePath(folderPath, resolvedConfig);
    if (!targetFilePath) {
        return createEmptyBatch("File delete", filePath);
    }

    const beforeContent = await readTextFileIfExists(targetFilePath);
    if (beforeContent === null) {
        return createEmptyBatch("File delete", filePath);
    }

    const nextContent = removeModDeclarations(beforeContent, fileName);
    if (nextContent === beforeContent) {
        return createEmptyBatch("File delete", filePath);
    }

    return {
        label: "File delete",
        sourcePath: filePath,
        changes: [{
            targetFilePath,
            beforeContent,
            afterContent: normalizeAfterContent(targetFilePath, nextContent),
            reason: "Remove module declaration",
            formatAfterApply: resolvedConfig.rule.fmt === "enabled"
        }]
    };
}

export async function planFileRename(oldUri: vscode.Uri, newUri: vscode.Uri): Promise<AutomodOperationBatch> {
    const oldFilePath = oldUri.fsPath;
    const newFilePath = newUri.fsPath;
    if (!validateRustFileOperation(newFilePath, "rename")) {
        return createEmptyBatch("File rename", newFilePath);
    }

    const oldFileName = path.basename(oldFilePath, ".rs");
    const newFileName = path.basename(newFilePath, ".rs");
    if (isSpecialRustFile(oldFileName) || isSpecialRustFile(newFileName)) {
        return createEmptyBatch("File rename", newFilePath);
    }

    const oldResolved = await resolveProjectConfigAsync(oldFilePath);
    const newResolved = await resolveProjectConfigAsync(newFilePath);
    const oldTargetFilePath = await resolveTargetFilePath(path.dirname(oldFilePath), oldResolved);
    const newTargetFilePath = await resolveTargetFilePath(path.dirname(newFilePath), newResolved);

    const changes: AutomodFileChange[] = [];
    if (oldTargetFilePath && oldTargetFilePath === newTargetFilePath) {
        const beforeContent = await readTextFileIfExists(oldTargetFilePath);
        if (beforeContent) {
            const removed = removeModDeclarations(beforeContent, oldFileName);
            const nextContent = addModDeclarations(removed, buildModDeclarations(newFileName, newResolved.rule), newResolved.rule);
            if (nextContent !== beforeContent) {
                changes.push({
                    targetFilePath: oldTargetFilePath,
                    beforeContent,
                    afterContent: ensureTrailingNewline(nextContent),
                    reason: "Rename module declaration",
                    formatAfterApply: oldResolved.rule.fmt === "enabled" || newResolved.rule.fmt === "enabled"
                });
            }
        }
    } else {
        const deleteBatch = await planFileDelete(oldUri);
        const createBatch = await planNewFile(newUri);
        changes.push(...deleteBatch.changes, ...createBatch.changes);
    }

    return {
        label: "File rename",
        sourcePath: newFilePath,
        changes: mergeChangesByTarget(changes)
    };
}

async function planScopeOperation(resource: vscode.Uri | undefined, previewOnly: boolean): Promise<AutomodOperationBatch> {
    if (resource?.fsPath.endsWith(".rs")) {
        return previewOnly ? planNewFile(resource) : planNewFile(resource);
    }

    const folders = resource
        ? [resource.fsPath]
        : (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath);

    const changes: AutomodFileChange[] = [];
    for (const folderPath of folders) {
        const batch = await planRegenerationForFolder(folderPath);
        changes.push(...batch.changes);
    }

    return {
        label: "Regenerate modules",
        sourcePath: resource?.fsPath,
        changes: mergeChangesByTarget(changes)
    };
}

async function planRegenerationForFolder(folderPath: string): Promise<AutomodOperationBatch> {
    const stagedChanges: AutomodFileChange[] = [];
    const directories = (await listDirectoriesRecursively(folderPath))
        .filter(candidate => !isBlacklistedPath(candidate));

    for (const directory of directories) {
        const rustModules = await listImmediateRustModules(directory);
        for (const moduleName of rustModules) {
            const modulePath = path.join(directory, `${moduleName}.rs`);
            const createBatch = await planNewFile(vscode.Uri.file(modulePath));
            stagedChanges.push(...createBatch.changes);
        }

        const childFolders = await listImmediateModuleFolders(directory);
        const parentTarget = await resolveModuleRegistrationFile(directory);
        if (!parentTarget) {
            continue;
        }

        for (const childFolder of childFolders) {
            const childConfig = await getProjectConfigAsync(path.join(directory, childFolder, "mod.rs"));
            const change = await planEnsureModuleRegistered(parentTarget, childFolder, childConfig, "Register nested module folder");
            if (change) {
                stagedChanges.push(change);
            }
        }
    }

    const registrationFiles = await collectRegistrationFiles(folderPath);
    for (const registrationFile of registrationFiles) {
        const beforeContent = await readTextFileIfExists(registrationFile);
        if (beforeContent === null) {
            continue;
        }

        const sourceDirectory = await resolveSourceDirectoryForRegistrationFile(registrationFile);
        const desiredModules = new Set([
            ...await listImmediateRustModules(sourceDirectory),
            ...await listImmediateModuleFolders(sourceDirectory)
        ]);
        let nextContent = beforeContent;

        for (const declaration of parseModDeclarations(beforeContent.split(/\r?\n/))) {
            const moduleName = declaration.modLine.match(/(?:pub(?:\((?:crate|super)\))?\s+)?mod\s+(\w+)/)?.[1];
            if (!moduleName || desiredModules.has(moduleName)) {
                continue;
            }

            nextContent = removeModDeclarations(nextContent, moduleName);
        }

        if (nextContent !== beforeContent) {
            const config = await getProjectConfigAsync(registrationFile);
            stagedChanges.push({
                targetFilePath: registrationFile,
                beforeContent,
                afterContent: normalizeAfterContent(registrationFile, nextContent),
                reason: "Remove stale module declarations",
                formatAfterApply: config.fmt === "enabled"
            });
        }
    }

    return {
        label: "Regenerate folder",
        sourcePath: folderPath,
        changes: mergeChangesByTarget(stagedChanges)
    };
}

async function planEnsureModuleRegistered(
    targetFilePath: string,
    moduleName: string,
    config: AutomodRule,
    reason: string
): Promise<AutomodFileChange | null> {
    const beforeContent = await readTextFileIfExists(targetFilePath);
    const nextContent = addModDeclarations(beforeContent ?? "", buildModDeclarations(moduleName, config), config);
    const normalizedAfter = ensureTrailingNewline(nextContent);
    if ((beforeContent ?? "") === normalizedAfter) {
        return null;
    }

    return {
        targetFilePath,
        beforeContent,
        afterContent: normalizedAfter,
        reason,
        formatAfterApply: config.fmt === "enabled"
    };
}

async function applyPlannedBatch(batch: AutomodOperationBatch, forcePreview = false): Promise<void> {
    const previewBeforeApply = forcePreview || vscode.workspace.getConfiguration("rustautomod").get<boolean>("previewBeforeApply", false);
    await getRuntime().applyBatch(batch, {
        preview: previewBeforeApply,
        confirmBeforeApply: previewBeforeApply,
        recordHistory: true
    });
}

async function resolveTargetRegistration(
    folderPath: string,
    resolvedConfig: ResolvedAutomodConfig
) {
    return resolveModuleRegistrationTarget(folderPath, resolvedConfig.rule.target ?? "auto");
}

async function resolveTargetFilePath(folderPath: string, resolvedConfig: ResolvedAutomodConfig): Promise<string | null> {
    const target = await resolveTargetRegistration(folderPath, resolvedConfig);
    return target?.filePath ?? null;
}

function shouldSkipByResolvedConfig(resolvedConfig: ResolvedAutomodConfig): boolean {
    if (resolvedConfig.ignored) {
        return true;
    }

    return resolvedConfig.strictMode === "error"
        && resolvedConfig.diagnostics.length > 0;
}

function validateRustFileOperation(filePath: string, operation: string): boolean {
    if (isValidRustPath(filePath)) {
        return true;
    }

    const reason = getPathRejectionReason(filePath);
    console.log(`RUST AUTOMOD: Skipping file ${operation} - ${reason}: ${filePath}`);
    return false;
}

function isSpecialRustFile(fileName: string): boolean {
    return fileName === "mod"
        || fileName === "lib"
        || fileName === "main"
        || fileName === "build";
}

function ensureTrailingNewline(content: string): string {
    if (content === "") {
        return "";
    }

    return content.endsWith("\n") ? content : `${content}\n`;
}

function normalizeAfterContent(targetFilePath: string, content: string): string | null {
    const trimmed = content.trim();
    if (trimmed === "" && path.basename(targetFilePath) === "mod.rs") {
        return null;
    }

    return ensureTrailingNewline(content);
}

function createEmptyBatch(label: string, sourcePath?: string): AutomodOperationBatch {
    return {
        label,
        sourcePath,
        changes: []
    };
}

function mergeChangesByTarget(changes: AutomodFileChange[]): AutomodFileChange[] {
    const merged = new Map<string, AutomodFileChange>();

    for (const change of changes) {
        const existing = merged.get(change.targetFilePath);
        if (!existing) {
            merged.set(change.targetFilePath, change);
            continue;
        }

        merged.set(change.targetFilePath, {
            targetFilePath: change.targetFilePath,
            beforeContent: existing.beforeContent,
            afterContent: change.afterContent,
            reason: `${existing.reason}; ${change.reason}`,
            formatAfterApply: existing.formatAfterApply || change.formatAfterApply
        });
    }

    return Array.from(merged.values()).filter(change => change.beforeContent !== change.afterContent);
}

async function collectRegistrationFiles(folderPath: string): Promise<string[]> {
    const directories = (await listDirectoriesRecursively(folderPath))
        .filter(candidate => !isBlacklistedPath(candidate));
    const results: string[] = [];

    for (const directory of directories) {
        const entries = await fs.readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith(".rs")) {
                continue;
            }

            const filePath = path.join(directory, entry.name);
            if (entry.name === "mod.rs" || entry.name === "lib.rs" || entry.name === "main.rs") {
                results.push(filePath);
                continue;
            }

            if (await isModulePairRegistrationFile(filePath)) {
                results.push(filePath);
            }
        }
    }

    return Array.from(new Set(results));
}

async function resolveFolderResourceUri(resource?: vscode.Uri): Promise<vscode.Uri | undefined> {
    if (resource) {
        if (await isDirectory(resource.fsPath)) {
            return resource;
        }

        return vscode.Uri.file(path.dirname(resource.fsPath));
    }

    const activeDocument = vscode.window.activeTextEditor?.document;
    if (activeDocument) {
        if (await isDirectory(activeDocument.uri.fsPath)) {
            return activeDocument.uri;
        }

        return vscode.Uri.file(path.dirname(activeDocument.uri.fsPath));
    }

    return vscode.workspace.workspaceFolders?.[0]?.uri;
}

async function resolveResourceUri(resource?: vscode.Uri): Promise<vscode.Uri | undefined> {
    if (resource) {
        return resource;
    }

    const activeDocument = vscode.window.activeTextEditor?.document;
    if (activeDocument && activeDocument.languageId === "rust") {
        return activeDocument.uri;
    }

    return undefined;
}

async function showMarkdownDocument(content: string): Promise<void> {
    const document = await vscode.workspace.openTextDocument({
        language: "markdown",
        content
    });
    await vscode.window.showTextDocument(document, { preview: true });
}

async function isDirectory(targetPath: string): Promise<boolean> {
    const stats = await fs.stat(targetPath);
    return stats.isDirectory();
}

async function resolveModuleSourceUri(resource?: vscode.Uri): Promise<vscode.Uri | undefined> {
    const target = await resolveResourceUri(resource);
    if (!target) {
        return undefined;
    }

    if (!target.fsPath.endsWith(".rs")) {
        return undefined;
    }

    const baseName = path.basename(target.fsPath);
    if (baseName === "lib.rs" || baseName === "main.rs" || baseName === "build.rs") {
        return undefined;
    }

    return target;
}

async function resolveDeclarationTargetForModule(filePath: string): Promise<{ targetFilePath: string, moduleName: string } | null> {
    const baseName = path.basename(filePath);
    if (baseName === "mod.rs") {
        const parentTarget = await resolveModuleRegistrationFile(path.dirname(filePath));
        return parentTarget
            ? {
                targetFilePath: parentTarget,
                moduleName: path.basename(path.dirname(filePath))
            }
            : null;
    }

    if (await isModulePairRegistrationFile(filePath)) {
        const parentTarget = await resolveModuleRegistrationFile(path.dirname(filePath));
        return parentTarget
            ? {
                targetFilePath: parentTarget,
                moduleName: path.basename(filePath, ".rs")
            }
            : null;
    }

    const resolvedConfig = await resolveProjectConfigAsync(filePath);
    const targetFilePath = await resolveTargetFilePath(path.dirname(filePath), resolvedConfig);
    if (!targetFilePath) {
        return null;
    }

    return {
        targetFilePath,
        moduleName: path.basename(filePath, ".rs")
    };
}

async function pickVisibility(): Promise<AutomodVisibility | undefined> {
    const selection = await vscode.window.showQuickPick([
        {
            label: "pub",
            description: "Visible outside the current module tree"
        },
        {
            label: "pub(crate)",
            description: "Visible across the current crate"
        },
        {
            label: "private",
            description: "Visible only inside the parent module"
        }
    ], {
        placeHolder: "Choose the module visibility"
    });

    if (!selection) {
        return undefined;
    }

    if (selection.label === "pub(crate)") {
        return "pub(crate)";
    }

    if (selection.label === "private") {
        return "private";
    }

    return "pub";
}

function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, "/");
}

function getRuntime(): AutomodRuntime {
    if (!runtime) {
        throw new Error("Rust AutoMod runtime has not been configured yet.");
    }

    return runtime;
}

function buildScaffoldContent(): string {
    return [
        "# Rust AutoMod scaffold",
        "schema_version=1",
        "strict=warn",
        "visibility=pub",
        "sort=alpha",
        "fmt=disabled",
        "target=auto",
        "group_order=use,cfg,pub_mod,mod,pub_use",
        "blank_lines=1",
        "reexport=disabled",
        "generated_comment=managed by rustautomod",
        "",
        "# Folder-specific override",
        "pattern=internal,!tests",
        "visibility=private",
        "sort=alpha_case_insensitive",
        "exclude=generated/**",
        "fmt=enabled"
    ].join("\n");
}
