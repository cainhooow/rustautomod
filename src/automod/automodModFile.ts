import vscode from "vscode";
import path from "path";
import fs from "fs";
import { getProjectConfig } from "./automodConfigFile";
import { ModDeclaration } from "../interfaces/modeclaration";
import { exec } from "child_process";

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

function getModDeclarations(name: string, filePath: string): string[] {
    const config = getProjectConfig(filePath);
    const visibility = config.visibility === "private" ? "mod" : "pub mod";
    const modLine = `${visibility} ${name};`;

    if (!config.cfg || config.cfg.length === 0) {
        return [modLine];
    }

    return config.cfg.flatMap(condition => {
        return [`#[cfg(${condition})]`, modLine];
    });
}

function parseModDeclarations(lines: string[]): ModDeclaration[] {
    const modDeclarations: ModDeclaration[] = [];

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();

        if (trimmed.startsWith('mod ') || trimmed.startsWith('pub mod ')) {
            const attributes: string[] = [];
            const fullBlock: string[] = [];
            let startIndex = i;

            let j = i - 1;
            while (j >= 0) {
                const prevTrimmed = lines[j].trim();
                if (prevTrimmed.startsWith('#[') || prevTrimmed.startsWith('#!')) {
                    attributes.unshift(lines[j]);
                    fullBlock.unshift(lines[j]);
                    startIndex = j;
                    j--;
                } else if (prevTrimmed === "" || prevTrimmed.startsWith("//")) {
                    j--;
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

function extractModuleName(modLine: string): string {
    const match = modLine.match(/(?:pub\s+)?mod\s+(\w+)/);
    return match ? match[1] : "";
}

function findInsertionPoint(lines: string[]): number {
    let afterHeaderIndex = 0;

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
            break;
        }
    }

    if (useBlockEnd >= 0) {
        let insertIndex = useBlockEnd + 1;

        while (insertIndex < lines.length && lines[insertIndex].trim() === "") {
            insertIndex++;
        }

        return insertIndex;
    } else {
        return afterHeaderIndex;
    }
}

function addModLine(content: string, newLines: string[], filePath: string): string {
    const config = getProjectConfig(filePath);
    const lines = content.split(/\r?\n/);

    const existingMods = parseModDeclarations(lines);
    const modLine = newLines.find(line => line.includes("mod ")) || "";
    const newModuleName = extractModuleName(modLine);


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
        const lastMod = existingMods[existingMods.length - 1];
        insertIndex = lastMod.endIndex + 1;
    } else {
        insertIndex = findInsertionPoint(lines);
    }

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

function sortModDeclarations(lines: string[]): void {
    const modDeclarations = parseModDeclarations(lines);

    if (modDeclarations.length <= 1) {
        return;
    }

    const insertionIndex = modDeclarations[0].startIndex;

    const sortedDeclarations = [...modDeclarations].sort((a, b) => {
        const nameA = extractModuleName(a.modLine);
        const nameB = extractModuleName(b.modLine);
        return nameA.localeCompare(nameB);
    });

    for (let i = modDeclarations.length - 1; i >= 0; i--) {
        const decl = modDeclarations[i];
        const removeCount = decl.endIndex - decl.startIndex + 1;
        lines.splice(decl.startIndex, removeCount);
    }

    const newBlockContent = sortedDeclarations.flatMap(decl => decl.fullBlock);

    lines.splice(insertionIndex, 0, ...newBlockContent);
}


export async function handleNewFile(uri: vscode.Uri) {
    const filePath = uri.fsPath;
    const folderPath = path.dirname(filePath);
    const fileName = path.basename(filePath, ".rs");

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

    const modFilePath = path.join(folderPath, "mod.rs");
    if (!fs.existsSync(modFilePath)) {
        const newModLines = getModDeclarations(fileName, filePath);
        fs.writeFileSync(modFilePath, newModLines.join("\n") + "\n");
        if (config.fmt === "enabled") { await runCargoFmt(modFilePath); }
    } else {
        let content = fs.readFileSync(modFilePath, "utf-8");
        const newModLines = getModDeclarations(fileName, filePath);
        const updatedContent = addModLine(content, newModLines, filePath);
        if (updatedContent !== content) {
            fs.writeFileSync(modFilePath, updatedContent);
            if (config.fmt === "enabled") { await runCargoFmt(modFilePath); }
        }
    }

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

export async function handleFileDelete(uri: vscode.Uri) {
    const filePath = uri.fsPath;
    const folderPath = path.dirname(filePath);
    const fileName = path.basename(filePath, ".rs");

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

    const modsToRemove = modDeclarations.filter(mod =>
        extractModuleName(mod.modLine) === targetModuleName
    );

    if (modsToRemove.length > 0) {
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