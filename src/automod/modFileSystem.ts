import path from "path";
import { promises as fs } from "fs";
import { AutomodTarget } from "../interfaces/automodconf";

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
    const rootFile = await resolveRootModuleRegistrationFile(folderPath);
    if (rootFile) {
        return rootFile;
    }

    const modRsPath = path.join(folderPath, "mod.rs");
    return (await fileExists(modRsPath)) ? modRsPath : null;
}

export async function resolveModuleRegistrationFileForTarget(
    folderPath: string,
    target: AutomodTarget
): Promise<string | null> {
    switch (target) {
        case "mod.rs":
            return path.join(folderPath, "mod.rs");
        case "lib.rs":
            return await resolveNamedTargetFile(folderPath, "lib.rs");
        case "main.rs":
            return await resolveNamedTargetFile(folderPath, "main.rs");
        case "auto":
        default:
            return resolveModuleRegistrationFile(folderPath);
    }
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

async function resolveNamedTargetFile(folderPath: string, targetFileName: "lib.rs" | "main.rs"): Promise<string | null> {
    let currentFolder = folderPath;

    while (currentFolder !== path.dirname(currentFolder)) {
        const targetPath = path.join(currentFolder, targetFileName);
        if (await fileExists(targetPath)) {
            return targetPath;
        }

        currentFolder = path.dirname(currentFolder);
    }

    return null;
}

function isFileNotFound(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && (error as { code?: string }).code === "ENOENT";
}
