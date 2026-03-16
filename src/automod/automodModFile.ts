import vscode from "vscode";
import path from "path";
import { promises as fs } from "fs";
import {
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
    sortModDeclarationsInContent
} from "./modContentEditor";
import { buildModDeclarations, parseModDeclarations } from "./modDeclarations";
import {
    fileExists,
    listDirectoriesRecursively,
    listImmediateModuleFolders,
    listImmediateRustModules,
    readTextFileIfExists,
    resolveModuleRegistrationFile,
    resolveModuleRegistrationFileForTarget,
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
    const targetFilePath = await resolveTargetFilePath(folderPath, resolvedConfig);
    if (targetFilePath) {
        const change = await planEnsureModuleRegistered(targetFilePath, fileName, resolvedConfig.rule, "Register module");
        if (change) {
            changes.push(change);
        }
    }

    if (targetFilePath?.endsWith("mod.rs")) {
        const parentTargetFilePath = await resolveModuleRegistrationFile(path.dirname(folderPath));
        if (parentTargetFilePath) {
            const parentModuleConfig = await getProjectConfigAsync(path.join(folderPath, "mod.rs"));
            const parentChange = await planEnsureModuleRegistered(
                parentTargetFilePath,
                path.basename(folderPath),
                parentModuleConfig,
                "Register child module folder"
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

        const desiredModules = new Set([
            ...await listImmediateRustModules(path.dirname(registrationFile)),
            ...await listImmediateModuleFolders(path.dirname(registrationFile))
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

async function resolveTargetFilePath(folderPath: string, resolvedConfig: ResolvedAutomodConfig): Promise<string | null> {
    const target = await resolveModuleRegistrationFileForTarget(folderPath, resolvedConfig.rule.target ?? "auto");
    if (target) {
        return target;
    }

    if ((resolvedConfig.rule.target ?? "auto") === "auto" || resolvedConfig.rule.target === "mod.rs") {
        return path.join(folderPath, "mod.rs");
    }

    return null;
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
        for (const candidate of ["mod.rs", "lib.rs", "main.rs"]) {
            const filePath = path.join(directory, candidate);
            if (await fileExists(filePath)) {
                results.push(filePath);
            }
        }
    }

    return results;
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
