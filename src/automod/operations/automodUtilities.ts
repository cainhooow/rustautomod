import vscode from "vscode";
import path from "path";
import { promises as fs } from "fs";
import {
    AutomodVisibility,
    AutomodRule,
    ResolvedAutomodConfig
} from "../../interfaces/automodconf";
import { AutomodFileChange, AutomodOperationBatch } from "../../interfaces/automodoperation";
import { getPathRejectionReason, isValidRustPath, isBlacklistedPath } from "../../utils/pathValidator";
import {
    getProjectConfigAsync,
    resolveProjectConfigAsync
} from "../automodConfigFile";
import {
    fileExists,
    isModulePairRegistrationFile,
    listDirectoriesRecursively,
    readTextFileIfExists,
    resolveModuleRegistrationFile,
    resolveModuleRegistrationTarget,
    writeTextFile
} from "../modFileSystem";

export async function resolveTargetRegistration(
    folderPath: string,
    resolvedConfig: ResolvedAutomodConfig
) {
    return resolveModuleRegistrationTarget(folderPath, resolvedConfig.rule.target ?? "auto");
}

export async function resolveTargetFilePath(folderPath: string, resolvedConfig: ResolvedAutomodConfig): Promise<string | null> {
    const target = await resolveTargetRegistration(folderPath, resolvedConfig);
    return target?.filePath ?? null;
}

export function shouldSkipByResolvedConfig(resolvedConfig: ResolvedAutomodConfig): boolean {
    if (resolvedConfig.ignored) {
        return true;
    }

    return resolvedConfig.strictMode === "error"
        && resolvedConfig.diagnostics.length > 0;
}

export function validateRustFileOperation(filePath: string, operation: string): boolean {
    if (isValidRustPath(filePath)) {
        return true;
    }

    const reason = getPathRejectionReason(filePath);
    console.log(`RUST AUTOMOD: Skipping file ${operation} - ${reason}: ${filePath}`);
    return false;
}

export function isSpecialRustFile(fileName: string): boolean {
    return fileName === "mod"
        || fileName === "lib"
        || fileName === "main"
        || fileName === "build";
}

export function ensureTrailingNewline(content: string): string {
    if (content === "") {
        return "";
    }

    return content.endsWith("\n") ? content : `${content}\n`;
}

export function normalizeAfterContent(targetFilePath: string, content: string): string | null {
    const trimmed = content.trim();
    if (trimmed === "" && path.basename(targetFilePath) === "mod.rs") {
        return null;
    }

    return ensureTrailingNewline(content);
}

export function createEmptyBatch(label: string, sourcePath?: string): AutomodOperationBatch {
    return {
        label,
        sourcePath,
        changes: []
    };
}

export function mergeChangesByTarget(changes: AutomodFileChange[]): AutomodFileChange[] {
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

export async function collectRegistrationFiles(folderPath: string): Promise<string[]> {
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

export async function resolveFolderResourceUri(resource?: vscode.Uri): Promise<vscode.Uri | undefined> {
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

export async function resolveResourceUri(resource?: vscode.Uri): Promise<vscode.Uri | undefined> {
    if (resource) {
        return resource;
    }

    const activeDocument = vscode.window.activeTextEditor?.document;
    if (activeDocument && activeDocument.languageId === "rust") {
        return activeDocument.uri;
    }

    return undefined;
}

export async function showMarkdownDocument(content: string): Promise<void> {
    const document = await vscode.workspace.openTextDocument({
        language: "markdown",
        content
    });
    await vscode.window.showTextDocument(document, { preview: true });
}

export async function isDirectory(targetPath: string): Promise<boolean> {
    const stats = await fs.stat(targetPath);
    return stats.isDirectory();
}

export async function resolveModuleSourceUri(resource?: vscode.Uri): Promise<vscode.Uri | undefined> {
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

export async function resolveDeclarationTargetForModule(filePath: string): Promise<{ targetFilePath: string, moduleName: string } | null> {
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

export async function pickVisibility(): Promise<AutomodVisibility | undefined> {
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

export function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, "/");
}

export function buildScaffoldContent(): string {
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

export {
    fileExists,
    getProjectConfigAsync,
    readTextFileIfExists,
    resolveProjectConfigAsync,
    resolveModuleRegistrationFile,
    writeTextFile
};
