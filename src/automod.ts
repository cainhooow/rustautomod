import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface AutomodRule {
    visibility: "pub" | "private";
    sort: "alpha" | "none";
    pattern?: string[];
}

function parseRautomod(content: string): AutomodRule[] {
    const blocks = content
        .split(/\n\s*\n/)
        .map(b => b.trim())
        .filter(Boolean);

    return blocks.map(block => {
        const rule: AutomodRule = { visibility: "pub", sort: "none" };
        const lines = block.split("\n");

        for (const line of lines) {
            if (line.startsWith("#")) continue;

            const [key, rawValue] = line.split("=").map(s => s.trim());
            if (!key || rawValue === undefined) continue;

            switch (key) {
                case "visibility":
                    if (rawValue === "pub" || rawValue === "private") {
                        rule.visibility = rawValue;
                    }
                    break;
                case "sort":
                    if (rawValue === "alpha" || rawValue === "none") {
                        rule.sort = rawValue;
                    }
                    break;
                case "pattern":
                    rule.pattern = rawValue.split(",").map(s => s.trim()).filter(Boolean);
                    break;
            }
        }

        return rule;
    })
}

function findCfgForFile(rules: AutomodRule[], filePath: string): AutomodRule | null {
    const fileName = path.basename(filePath);

    for (const rule of rules) {
        if (!rule.pattern) continue;

        for (const p of rule.pattern) {
            if (filePath.includes(p) || fileName === p) {
                return rule;
            }
        }
    }

    return rules.find(r => !r.pattern) || null;
}

function getProjectConfig(filePath: string): AutomodRule {
    let dir = path.dirname(filePath);
    while (dir !== path.dirname(dir)) {
        const configFile = path.join(dir, ".rautomod");
        if (fs.existsSync(configFile)) {
            const content = fs.readFileSync(configFile, "utf-8");
            const rules = parseRautomod(content);
            const rule = findCfgForFile(rules, filePath);
            if (rule) return rule;
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
    const lines = content.split(/\r?\n/);

    if (lines.includes(newLine)) {
        return content;
    }

    let insertIndex = 0;
    while (
        insertIndex < lines.length &&
        (lines[insertIndex].trim().startsWith("//") ||
            lines[insertIndex].trim().startsWith("/*") ||
            lines[insertIndex].trim().startsWith("#!") ||
            lines[insertIndex].trim().startsWith("//!") ||
            lines[insertIndex].trim() === "")
    ) {
        insertIndex++;
    }

    lines.splice(insertIndex, 0, newLine);

    if (config.sort === "alpha") {
        const beforeDecl = lines.slice(0, insertIndex + 1).filter(l => l.trim() !== "");
        const afterDecl = lines.slice(insertIndex + 1);
        beforeDecl.sort();
        return [...beforeDecl, ...afterDecl].join("\n") + "\n";
    }

    return lines.join("\n") + "\n";
}

export async function handleNewFile(uri: vscode.Uri) {
    const filePath = uri.fsPath;
    const folderPath = path.dirname(filePath);
    const fileName = path.basename(filePath, ".rs");

    if (fileName === "mod" || fileName === "lib" || fileName === "main") return;

    const libRsPath = path.join(folderPath, "lib.rs");
    const mainRsPath = path.join(folderPath, "main.rs");

    if (fs.existsSync(libRsPath) || fs.existsSync(mainRsPath)) {
        const rootFilePath = fs.existsSync(libRsPath) ? libRsPath : mainRsPath;

        const newModLine = getModDeclaration(fileName, filePath);
        let content = fs.readFileSync(rootFilePath, "utf-8");

        if (!content.split(/\r?\n/).includes(newModLine)) {
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
        const newMod = getModDeclaration(fileName, filePath);

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
