import vscode from "vscode";
import path from "path";
import fs from "fs";
import { promises as fsPromises } from "fs";
import { AutomodRule } from "../interfaces/automodconf";
import { smartSplitCfg } from "./cfgUtils";

export function parseRautomod(content: string) {
    const blocks = content
        .split(/\n\s*\n/);

    return blocks.map(block => {
        const rule: AutomodRule =
        {
            visibility: "pub",
            sort: "none",
            fmt: "disabled"
        };
        const lines = block.split("\n");

        for (const line of lines) {
            if (line.startsWith("#")) {continue;}

            const separatorIndex = line.indexOf("=");
            if (separatorIndex === -1) {continue;}

            const key = line.substring(0, separatorIndex).trim();
            const rawValue = line.substring(separatorIndex + 1).trim();

            if (!key || rawValue === undefined) {continue;}

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
                case "cfg":
                    rule.cfg = smartSplitCfg(rawValue);
                    break;
                case "fmt":
                    if (rawValue === "enabled" || rawValue === "disabled") {
                        rule.fmt = rawValue;
                    }
                    break;
            }
        }

        return rule;
    });
}

export function findConfigForFile(rules: AutomodRule[], filePath: string): AutomodRule | null {
    const fileName = path.basename(filePath);

    for (const rule of rules) {
        if (!rule.pattern) {continue;}

        for (const pattern of rule.pattern) {
            if (filePath.includes(pattern) || fileName === pattern) {
                return rule;
            }
        }
    }

    return rules.find(rule => !rule.pattern) || null;
}

export function getProjectConfig(filePath: string): AutomodRule {
    let dir = path.dirname(filePath);

    while (dir !== path.dirname(dir)) {
        const configFile = path.join(dir, ".rautomod");
        if (fs.existsSync(configFile)) {
            const content = fs.readFileSync(configFile, "utf-8");
            const rules = parseRautomod(content);
            const rule = findConfigForFile(rules, filePath);
            if (rule) {return rule;}
        }

        dir = path.dirname(dir);
    }

    const vscodeConfig = vscode.workspace.getConfiguration("rustautomod");
    return getDefaultConfig(vscodeConfig);
}

export async function getProjectConfigAsync(filePath: string): Promise<AutomodRule> {
    let dir = path.dirname(filePath);

    while (dir !== path.dirname(dir)) {
        const configFile = path.join(dir, ".rautomod");

        try {
            const content = await fsPromises.readFile(configFile, "utf-8");
            const rules = parseRautomod(content);
            const rule = findConfigForFile(rules, filePath);
            if (rule) {
                return rule;
            }
        } catch (error) {
            if (!isFileNotFound(error)) {
                console.error(`RUST AUTOMOD: Failed to read ${configFile}:`, error);
            }
        }

        dir = path.dirname(dir);
    }

    return getDefaultConfig(vscode.workspace.getConfiguration("rustautomod"));
}

function getDefaultConfig(configuration: vscode.WorkspaceConfiguration): AutomodRule {
    return {
        visibility: configuration.get<"pub" | "private">("visibility", "pub"),
        sort: configuration.get<"alpha" | "none">("sort", "none"),
        fmt: configuration.get<"enabled" | "disabled">("fmt", "disabled")
    };
}

function isFileNotFound(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && (error as { code?: string }).code === "ENOENT";
}
