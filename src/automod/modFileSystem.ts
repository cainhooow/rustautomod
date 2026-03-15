import path from "path";
import { promises as fs } from "fs";

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

export async function writeTextFile(filePath: string, content: string): Promise<void> {
    await fs.writeFile(filePath, content, "utf8");
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

export function isSpecialRustFile(fileName: string): boolean {
    return fileName === "mod"
        || fileName === "lib"
        || fileName === "main"
        || fileName === "build";
}
