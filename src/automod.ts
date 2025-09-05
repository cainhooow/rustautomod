import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface AutoModConfig {
    visibility: "pub" | "private";
    sort: "alpha" | "none";
}
function getProjectConfig(filePath: string): AutoModConfig {
    let dir = path.dirname(filePath);
    while (dir !== path.dirname(dir)) {
        const configFile = path.join(dir, ".rautomod");
        if (fs.existsSync(configFile)) {
            const content = fs.readFileSync(configFile, "utf-8");
            const config: AutoModConfig = {
                visibility: "pub",
                sort: "none"
            };

            const visibilityMatch = content.match(/visibility\s*=\s*(pub|private)/);
            if (visibilityMatch) config.visibility = visibilityMatch[1] as "pub" | "private";

            const sortMatch = content.match(/sort\s*=\s*(alpha|none)/);
            if (sortMatch) config.sort = sortMatch[1] as "alpha" | "none";

            return config;
        }
        dir = path.dirname(dir);
    }

    const vscodeConfig = vscode.workspace.getConfiguration("rustautomod");
    return {
        visibility: vscodeConfig.get<"pub" | "private">("visibility", "pub"),
        sort: vscodeConfig.get<"alpha" | "none">("sort", "none")
    };
}

function getModDeclaration(name: string, filePath: string): string {
    const config = getProjectConfig(filePath);
    return config.visibility === "private"
        ? `mod ${name};`
        : `pub mod ${name};`
}

function addModLine(content: string, newLine: string, filePath: string): string {
    const config = getProjectConfig(filePath);
    const lines = content.split(/\r?\n/).filter(line => line.trim() !== "");

    if (!lines.includes(newLine)) {
        lines.push(newLine);
    }

    if (config.sort == "alpha") {
        lines.sort();
    }

    return lines.sort().join("\n") + "\n";
}

export async function handleNewFile(uri: vscode.Uri) {
    const filePath = uri.fsPath;
    const folderPath = path.dirname(filePath);
    const fileName = path.basename(filePath, ".rs");

    if (fileName === "mod" || fileName === "lib" || fileName === "main") return;

    const libRsPath = path.join(folderPath, "lib.rs");
    const mainRsPath = path.join(folderPath, "main.rs");

    let rootFilePath: string | null = null;
    if (fs.existsSync(libRsPath)) rootFilePath = libRsPath;
    else if (fs.existsSync(mainRsPath)) rootFilePath = mainRsPath;

    if (rootFilePath) {
        const newModLine = getModDeclaration(fileName, filePath) + "\n";
        let content = fs.readFileSync(rootFilePath, "utf-8");
        if (!content.includes(newModLine)) {
            content = addModLine(content, newModLine, filePath);
            fs.writeFileSync(rootFilePath, content);
        }
        return;
    }

    const modFilePath = path.join(folderPath, "mod.rs");
    if (!fs.existsSync(modFilePath)) {
        fs.writeFileSync(modFilePath, getModDeclaration(fileName, filePath) + "\n");
    } else {
        let content = fs.readFileSync(modFilePath, "utf-8");
        const newMod = getModDeclaration(fileName, filePath) + "\n";

        if (!content.includes(newMod)) {
            content = addModLine(content, newMod, filePath);
            fs.writeFileSync(modFilePath, content);
        }
    }

    const parentDir = path.dirname(folderPath);
    const parentMod = path.join(parentDir, "mod.rs");
    const folderName = path.basename(folderPath);

    if (fs.existsSync(parentMod)) {
        let parentContent = fs.readFileSync(parentMod, "utf-8");
        const newParentMod = getModDeclaration(folderName, parentMod);

        if (!parentContent.includes(newParentMod)) {
            parentContent = addModLine(parentContent, newParentMod, parentMod);
            fs.writeFileSync(parentMod, parentContent);
        }
    }
}

export async function handleFileDelete(uri: vscode.Uri) {
    const filePath = uri.fsPath;
    const folderPath = path.dirname(filePath);
    const fileName = path.basename(filePath, ".rs");

    if (fileName === "mod" || fileName === "lib" || fileName === "main") return;

    const libRsPath = path.join(folderPath, "lib.rs");
    const mainRsPath = path.join(folderPath, "main.rs");

    let rootFilePath: string | null = null;
    if (fs.existsSync(libRsPath)) rootFilePath = libRsPath;
    else if (fs.existsSync(mainRsPath)) rootFilePath = mainRsPath;

    if (rootFilePath) {
        const lineToRemove = getModDeclaration(fileName, filePath);
        let content = fs.readFileSync(rootFilePath, "utf-8");
        const newContent = content
            .split(/\r?\n/)
            .filter(line => line.trim() !== "" && line.trim() !== lineToRemove)
            .join("\n");
        fs.writeFileSync(rootFilePath, newContent + (newContent.trim() ? "\n" : ""));
        return;
    }

    const modFilePath = path.join(folderPath, "mod.rs");
    if (!fs.existsSync(modFilePath)) return;

    const lineToRemove = getModDeclaration(fileName, filePath);
    let content = fs.readFileSync(modFilePath, "utf-8");
    const newContent = content
        .split(/\r?\n/)
        .filter(line => line.trim() !== "" && line.trim() !== lineToRemove)
        .join("\n");

    if (newContent.trim() === "") {
        fs.unlinkSync(modFilePath);
    } else {
        fs.writeFileSync(modFilePath, newContent + "\n");
    }
}
