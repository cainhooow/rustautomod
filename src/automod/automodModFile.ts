import vscode from "vscode";
import path from "path";
import { AutomodRule } from "../interfaces/automodconf";
import { getPathRejectionReason, isValidRustPath } from "../utils/pathValidator";
import { getProjectConfigAsync } from "./automodConfigFile";
import { runCargoFmt } from "./cargoFmt";
import { addModDeclarations, removeModDeclarations, sortModDeclarationsInContent } from "./modContentEditor";
import { buildModDeclarations } from "./modDeclarations";
import {
    fileExists,
    isSpecialRustFile,
    resolveModuleRegistrationFile,
    resolveRootModuleRegistrationFile,
    updateTextFile,
    writeTextFile
} from "./modFileSystem";

export async function handleNewFile(uri: vscode.Uri): Promise<void> {
    const filePath = uri.fsPath;
    if (!validateRustFileOperation(filePath, "creation")) {
        return;
    }

    const folderPath = path.dirname(filePath);
    const fileName = path.basename(filePath, ".rs");
    if (isSpecialRustFile(fileName)) {
        return;
    }

    const fileConfig = await getProjectConfigAsync(filePath);
    const rootFilePath = await resolveRootModuleRegistrationFile(folderPath);

    if (rootFilePath) {
        await ensureModuleRegistered(rootFilePath, fileName, fileConfig);
        return;
    }

    const modFilePath = path.join(folderPath, "mod.rs");
    await ensureModuleRegistered(modFilePath, fileName, fileConfig);

    const parentModPath = path.join(path.dirname(folderPath), "mod.rs");
    if (await fileExists(parentModPath)) {
        const folderModulePath = path.join(folderPath, "mod.rs");
        const parentModuleConfig = await getProjectConfigAsync(folderModulePath);
        await ensureModuleRegistered(parentModPath, path.basename(folderPath), parentModuleConfig);
    }
}

export async function handleFileRename(oldUri: vscode.Uri, newUri: vscode.Uri): Promise<void> {
    const oldFilePath = oldUri.fsPath;
    const newFilePath = newUri.fsPath;
    if (!validateRustFileOperation(newFilePath, "rename")) {
        return;
    }

    const oldFileName = path.basename(oldFilePath, ".rs");
    const newFileName = path.basename(newFilePath, ".rs");
    if (isSpecialRustFile(oldFileName) || isSpecialRustFile(newFileName)) {
        return;
    }

    const folderPath = path.dirname(newFilePath);
    const config = await getProjectConfigAsync(newFilePath);
    const targetFilePath = await resolveModuleRegistrationFile(folderPath);
    if (!targetFilePath || config.sort !== "alpha") {
        return;
    }

    await delay(200);
    await updateModuleFile(targetFilePath, config, content => sortModDeclarationsInContent(content));
}

export async function handleFileDelete(uri: vscode.Uri): Promise<void> {
    const filePath = uri.fsPath;
    if (!validateRustFileOperation(filePath, "deletion")) {
        return;
    }

    const folderPath = path.dirname(filePath);
    const fileName = path.basename(filePath, ".rs");
    if (isSpecialRustFile(fileName)) {
        return;
    }

    const config = await getProjectConfigAsync(filePath);
    const targetFilePath = await resolveModuleRegistrationFile(folderPath);
    if (!targetFilePath) {
        return;
    }

    await updateModuleFile(targetFilePath, config, content => removeModDeclarations(content, fileName));
}

async function ensureModuleRegistered(
    targetFilePath: string,
    moduleName: string,
    config: AutomodRule
): Promise<void> {
    const newLines = buildModDeclarations(moduleName, config);
    const newFileContent = `${newLines.join("\n")}\n`;

    if (!await fileExists(targetFilePath)) {
        await writeTextFile(targetFilePath, newFileContent);
        await formatIfEnabled(targetFilePath, config);
        return;
    }

    await updateModuleFile(targetFilePath, config, content => addModDeclarations(content, newLines, config.sort));
}

async function updateModuleFile(
    filePath: string,
    config: AutomodRule,
    updater: (content: string) => string | Promise<string>
): Promise<void> {
    const changed = await updateTextFile(filePath, updater);
    if (changed) {
        await formatIfEnabled(filePath, config);
    }
}

async function formatIfEnabled(filePath: string, config: AutomodRule): Promise<void> {
    if (config.fmt === "enabled") {
        await runCargoFmt(filePath);
    }
}

function validateRustFileOperation(filePath: string, operation: string): boolean {
    if (isValidRustPath(filePath)) {
        return true;
    }

    const reason = getPathRejectionReason(filePath);
    console.log(`RUST AUTOMOD: Skipping file ${operation} - ${reason}: ${filePath}`);
    return false;
}

function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}
