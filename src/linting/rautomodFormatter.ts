import { smartSplitCfg } from "../automod/cfgUtils";

export function formatRautomod(content: string): string {
    const normalized = content.replace(/\r\n/g, "\n");
    const rawLines = normalized.split("\n");
    const formattedLines: string[] = [];
    let previousWasBlank = false;

    for (const rawLine of rawLines) {
        const line = rawLine.trimEnd();
        const trimmed = line.trim();

        if (trimmed === "") {
            if (!previousWasBlank && formattedLines.length > 0) {
                formattedLines.push("");
            }
            previousWasBlank = true;
            continue;
        }

        previousWasBlank = false;

        if (trimmed.startsWith("#")) {
            formattedLines.push(trimmed);
            continue;
        }

        formattedLines.push(formatAssignmentLine(trimmed));
    }

    while (formattedLines.length > 0 && formattedLines[formattedLines.length - 1] === "") {
        formattedLines.pop();
    }

    if (formattedLines.length === 0) {
        return "";
    }

    return `${formattedLines.join("\n")}\n`;
}

function formatAssignmentLine(line: string): string {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
        return line;
    }

    const key = line.substring(0, separatorIndex).trim();
    const rawValue = line.substring(separatorIndex + 1).trim();

    switch (key) {
        case "pattern":
        case "exclude":
        case "extends":
        case "group_order":
            return `${key}=${normalizeSimpleCommaList(rawValue)}`;
        case "cfg":
            return `${key}=${normalizeCfgList(rawValue)}`;
        case "visibility":
        case "sort":
        case "fmt":
        case "target":
        case "reexport":
        case "blank_lines":
        case "strict":
        case "schema_version":
        case "header":
        case "generated_comment":
            return `${key}=${rawValue}`;
        default:
            return `${key}=${rawValue}`;
    }
}

function normalizeSimpleCommaList(value: string): string {
    return value
        .split(",")
        .map(entry => entry.trim())
        .join(",");
}

function normalizeCfgList(value: string): string {
    return smartSplitCfg(value).join(",");
}
