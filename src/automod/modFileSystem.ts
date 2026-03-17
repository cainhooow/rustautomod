import path from "path";
import { promises as fs } from "fs";
import * as vscode from "vscode";
import { AutomodTarget } from "../interfaces/automodconf";

export type RustModuleLayoutPreference = "auto" | "classic" | "modern";
export type ResolvedRustModuleLayout = "classic" | "modern";
export type ModuleRegistrationTargetKind = "crate_root" | ResolvedRustModuleLayout;

export interface ModuleRegistrationTarget {
    filePath: string;
    exists: boolean;
    kind: ModuleRegistrationTargetKind;
    sourceDirectory: string;
}

export async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

export async function readTextFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, "utf8");
}

export async function readTextFileIfExists(filePath: string): Promise<string | null> {
    try {
        return await readTextFile(filePath);
    } catch (error) {
        if (isFileNotFound(error)) {
            return null;
        }

        throw error;
    }
}

export async function writeTextFile(filePath: string, content: string): Promise<void> {
    await fs.writeFile(filePath, content, "utf8");
}

export async function deleteTextFile(filePath: string): Promise<void> {
    await fs.rm(filePath, { force: true });
}

export async function updateTextFile(
    filePath: string,
    updater: (content: string) => string | Promise<string>
): Promise<boolean> {
    const currentContent = await readTextFile(filePath);
    const nextContent = await updater(currentContent);

    if (nextContent === currentContent) {
        return false;
    }

    await writeTextFile(filePath, nextContent);
    return true;
}

export async function resolveRootModuleRegistrationFile(folderPath: string): Promise<string | null> {
    const libRsPath = path.join(folderPath, "lib.rs");
    if (await fileExists(libRsPath)) {
        return libRsPath;
    }

    const mainRsPath = path.join(folderPath, "main.rs");
    if (await fileExists(mainRsPath)) {
        return mainRsPath;
    }

    return null;
}

export async function resolveModuleRegistrationFile(folderPath: string): Promise<string | null> {
    const target = await resolveModuleRegistrationTarget(folderPath, "auto");
    return target?.filePath ?? null;
}

export async function resolveModuleRegistrationFileForTarget(
    folderPath: string,
    target: AutomodTarget
): Promise<string | null> {
    const resolvedTarget = await resolveModuleRegistrationTarget(folderPath, target);
    return resolvedTarget?.filePath ?? null;
}

export async function resolveModuleRegistrationTarget(
    folderPath: string,
    target: AutomodTarget
): Promise<ModuleRegistrationTarget | null> {
    switch (target) {
        case "mod.rs":
            return {
                filePath: path.join(folderPath, "mod.rs"),
                exists: await fileExists(path.join(folderPath, "mod.rs")),
                kind: "classic",
                sourceDirectory: folderPath
            };
        case "lib.rs":
            return resolveNamedTarget(folderPath, "lib.rs");
        case "main.rs":
            return resolveNamedTarget(folderPath, "main.rs");
        case "auto":
        default:
            return resolveAutomaticModuleRegistrationTarget(folderPath);
    }
}

export async function detectRustModuleLayout(folderPath: string): Promise<ResolvedRustModuleLayout> {
    const configuredLayout = getConfiguredModuleLayout(folderPath);
    if (configuredLayout !== "auto") {
        return configuredLayout;
    }

    if (await fileExists(path.join(folderPath, "mod.rs"))) {
        return "classic";
    }

    if (await hasSiblingModuleFile(folderPath)) {
        return "modern";
    }

    let currentFolder = path.dirname(folderPath);
    while (currentFolder !== path.dirname(currentFolder)) {
        if (await fileExists(path.join(currentFolder, "mod.rs"))) {
            return "classic";
        }

        if (await hasSiblingModuleFile(currentFolder)) {
            return "modern";
        }

        currentFolder = path.dirname(currentFolder);
    }

    return "classic";
}

export async function resolveSourceDirectoryForRegistrationFile(registrationFilePath: string): Promise<string> {
    const normalizedPath = path.normalize(registrationFilePath);
    const baseName = path.basename(normalizedPath);

    if (baseName === "mod.rs" || baseName === "lib.rs" || baseName === "main.rs") {
        return path.dirname(normalizedPath);
    }

    const siblingFolder = path.join(
        path.dirname(normalizedPath),
        path.basename(normalizedPath, ".rs")
    );

    if (await isDirectory(siblingFolder)) {
        return siblingFolder;
    }

    return path.dirname(normalizedPath);
}

export async function isModulePairRegistrationFile(filePath: string): Promise<boolean> {
    const normalizedPath = path.normalize(filePath);
    if (!normalizedPath.endsWith(".rs")) {
        return false;
    }

    const baseName = path.basename(normalizedPath);
    if (baseName === "mod.rs" || baseName === "lib.rs" || baseName === "main.rs" || baseName === "build.rs") {
        return false;
    }

    return isDirectory(path.join(path.dirname(normalizedPath), path.basename(normalizedPath, ".rs")));
}

export async function listImmediateRustModules(folderPath: string): Promise<string[]> {
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    return entries
        .filter(entry => entry.isFile() && entry.name.endsWith(".rs"))
        .map(entry => path.basename(entry.name, ".rs"))
        .filter(fileName => !isSpecialRustFile(fileName))
        .sort();
}

export async function listImmediateModuleFolders(folderPath: string): Promise<string[]> {
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    const moduleFolders: string[] = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const childFolder = path.join(folderPath, entry.name);
        const childEntries = await fs.readdir(childFolder, { withFileTypes: true });
        const containsRustSources = childEntries.some(child =>
            child.isFile()
            && child.name.endsWith(".rs")
            && !isSpecialRustFile(path.basename(child.name, ".rs"))
        );

        const containsNestedMod = childEntries.some(child =>
            child.isFile() && child.name === "mod.rs"
        );

        if (containsRustSources || containsNestedMod) {
            moduleFolders.push(entry.name);
        }
    }

    return moduleFolders.sort();
}

export async function listDirectoriesRecursively(rootPath: string): Promise<string[]> {
    const result: string[] = [rootPath];
    const entries = await fs.readdir(rootPath, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const childPath = path.join(rootPath, entry.name);
        const nested = await listDirectoriesRecursively(childPath);
        result.push(...nested);
    }

    return result;
}

export function isSpecialRustFile(fileName: string): boolean {
    return fileName === "mod"
        || fileName === "lib"
        || fileName === "main"
        || fileName === "build";
}

async function resolveNamedTarget(folderPath: string, targetFileName: "lib.rs" | "main.rs"): Promise<ModuleRegistrationTarget | null> {
    let currentFolder = folderPath;

    while (currentFolder !== path.dirname(currentFolder)) {
        const targetPath = path.join(currentFolder, targetFileName);
        if (await fileExists(targetPath)) {
            return {
                filePath: targetPath,
                exists: true,
                kind: "crate_root",
                sourceDirectory: currentFolder
            };
        }

        currentFolder = path.dirname(currentFolder);
    }

    return null;
}

async function resolveAutomaticModuleRegistrationTarget(folderPath: string): Promise<ModuleRegistrationTarget | null> {
    const localRootTarget = await resolveRootModuleRegistrationFile(folderPath);
    if (localRootTarget) {
        return {
            filePath: localRootTarget,
            exists: true,
            kind: "crate_root",
            sourceDirectory: folderPath
        };
    }

    const layout = await detectRustModuleLayout(folderPath);
    if (layout === "modern") {
        const siblingFilePath = path.join(path.dirname(folderPath), `${path.basename(folderPath)}.rs`);
        return {
            filePath: siblingFilePath,
            exists: await fileExists(siblingFilePath),
            kind: "modern",
            sourceDirectory: folderPath
        };
    }

    const modRsPath = path.join(folderPath, "mod.rs");
    return {
        filePath: modRsPath,
        exists: await fileExists(modRsPath),
        kind: "classic",
        sourceDirectory: folderPath
    };
}

function getConfiguredModuleLayout(folderPath: string): RustModuleLayoutPreference {
    const configuration = vscode.workspace.getConfiguration("rustautomod", vscode.Uri.file(folderPath));
    const layout = configuration.get<RustModuleLayoutPreference>("moduleLayout", "auto");

    if (layout === "classic" || layout === "modern") {
        return layout;
    }

    return "auto";
}

async function hasSiblingModuleFile(folderPath: string): Promise<boolean> {
    const parentFolder = path.dirname(folderPath);
    if (parentFolder === folderPath) {
        return false;
    }

    const siblingFilePath = path.join(parentFolder, `${path.basename(folderPath)}.rs`);
    return fileExists(siblingFilePath);
}

async function isDirectory(targetPath: string): Promise<boolean> {
    try {
        const stats = await fs.stat(targetPath);
        return stats.isDirectory();
    } catch {
        return false;
    }
}

function isFileNotFound(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && (error as { code?: string }).code === "ENOENT";
}
