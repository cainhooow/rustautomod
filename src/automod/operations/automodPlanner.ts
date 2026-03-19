import vscode from "vscode";
import path from "path";
import { promises as fs } from "fs";
import { AutomodRule } from "../../interfaces/automodconf";
import { AutomodFileChange, AutomodOperationBatch } from "../../interfaces/automodoperation";
import { addModDeclarations, removeModDeclarations } from "../modContentEditor";
import { buildModDeclarations, parseModDeclarations } from "../modDeclarations";
import {
    isBlacklistedPath
} from "../../utils/pathValidator";
import {
    collectRegistrationFiles,
    createEmptyBatch,
    ensureTrailingNewline,
    fileExists,
    getProjectConfigAsync,
    isSpecialRustFile,
    mergeChangesByTarget,
    normalizeAfterContent,
    readTextFileIfExists,
    resolveModuleRegistrationFile,
    resolveTargetFilePath,
    resolveTargetRegistration,
    shouldSkipByResolvedConfig,
    validateRustFileOperation
} from "./automodUtilities";
import {
    listDirectoriesRecursively,
    listImmediateModuleFolders,
    listImmediateRustModules,
    resolveSourceDirectoryForRegistrationFile
} from "../modFileSystem";
import { resolveProjectConfigAsync } from "../automodConfigFile";

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

export async function planScopeOperation(resource: vscode.Uri | undefined): Promise<AutomodOperationBatch> {
    if (resource?.fsPath.endsWith(".rs")) {
        return planNewFile(resource);
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

export async function planEnsureModuleRegistered(
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
