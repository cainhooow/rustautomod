import { AutomodConfigDocument, AutomodRule } from "../../interfaces/automodconf";
import { formatRautomod } from "../../linting/rautomodFormatter";
import {
    DEFAULT_GROUP_ORDER,
    DOCUMENT_KEYS,
    RULE_KEYS
} from "./rautomodShared";

interface PreservedSourceBlock {
    kind: "document" | "rule" | "unmanaged";
    preservedLines: string[];
    rawLines: string[];
}

export function serializeRautomodDocument(document: AutomodConfigDocument, existingRawText?: string): string {
    if (!existingRawText?.trim()) {
        return formatRautomod(serializeDocumentWithoutPreservation(document));
    }

    return formatRautomod(serializeDocumentWithPreservedBlocks(document, existingRawText));
}

function serializeDocumentWithoutPreservation(document: AutomodConfigDocument): string {
    const lines = serializeDocumentHeaderLines(document);

    for (const rule of document.rules) {
        lines.push("");
        lines.push(...serializeRule(rule));
    }

    return lines.join("\n");
}

function serializeDocumentHeaderLines(document: AutomodConfigDocument): string[] {
    const lines = [
        `schema_version=${document.schemaVersion || "1"}`,
        `strict=${document.strictMode || "warn"}`
    ];

    if (document.extendsPaths.length > 0) {
        lines.push(`extends=${document.extendsPaths.join(",")}`);
    }

    return lines;
}

function serializeRule(rule: AutomodRule): string[] {
    const lines = [
        `visibility=${rule.visibility}`,
        `sort=${rule.sort}`,
        `fmt=${rule.fmt ?? "disabled"}`,
        `target=${rule.target ?? "auto"}`
    ];

    if (rule.pattern && rule.pattern.length > 0) {
        lines.push(`pattern=${rule.pattern.join(",")}`);
    }

    if (rule.exclude && rule.exclude.length > 0) {
        lines.push(`exclude=${rule.exclude.join(",")}`);
    }

    if (rule.cfg && rule.cfg.length > 0) {
        lines.push(`cfg=${rule.cfg.join(",")}`);
    }

    lines.push(`group_order=${(rule.groupOrder ?? DEFAULT_GROUP_ORDER).join(",")}`);
    lines.push(`blank_lines=${rule.blankLines ?? 1}`);
    lines.push(`reexport=${rule.reexport ?? "disabled"}`);

    if (rule.header?.trim()) {
        lines.push(`header=${rule.header.trim()}`);
    }

    if (rule.generatedComment?.trim()) {
        lines.push(`generated_comment=${rule.generatedComment.trim()}`);
    }

    return lines;
}

function serializeDocumentWithPreservedBlocks(document: AutomodConfigDocument, existingRawText: string): string {
    const blocks = parsePreservedSourceBlocks(existingRawText);
    const outputBlocks: string[][] = [];
    let documentEmitted = false;
    let ruleIndex = 0;

    for (const block of blocks) {
        if (block.kind === "document" && !documentEmitted) {
            outputBlocks.push(buildPreservedManagedBlock(block.preservedLines, serializeDocumentHeaderLines(document)));
            documentEmitted = true;
            continue;
        }

        if (block.kind === "rule") {
            if (ruleIndex < document.rules.length) {
                outputBlocks.push(buildPreservedManagedBlock(block.preservedLines, serializeRule(document.rules[ruleIndex])));
                ruleIndex += 1;
                continue;
            }

            if (block.preservedLines.length > 0) {
                outputBlocks.push(block.preservedLines);
            }
            continue;
        }

        if (block.rawLines.length > 0) {
            outputBlocks.push(block.rawLines);
        }
    }

    if (!documentEmitted) {
        const documentLines = serializeDocumentHeaderLines(document);
        const insertionIndex = outputBlocks.findIndex(block => block.some(line => extractRecognizedKey(line) !== null));
        if (insertionIndex === -1) {
            outputBlocks.push(documentLines);
        } else {
            outputBlocks.splice(insertionIndex, 0, documentLines);
        }
    }

    while (ruleIndex < document.rules.length) {
        outputBlocks.push(serializeRule(document.rules[ruleIndex]));
        ruleIndex += 1;
    }

    return outputBlocks
        .filter(block => block.some(line => line.trim() !== ""))
        .map(block => block.join("\n"))
        .join("\n\n");
}

function buildPreservedManagedBlock(preservedLines: string[], managedLines: string[]): string[] {
    return [
        ...preservedLines.filter(line => line.trim() !== ""),
        ...managedLines
    ];
}

function parsePreservedSourceBlocks(rawText: string): PreservedSourceBlock[] {
    const normalized = rawText.replace(/\r\n/g, "\n").trim();
    if (!normalized) {
        return [];
    }

    return normalized
        .split(/\n\s*\n/g)
        .map(blockText => classifyPreservedSourceBlock(blockText))
        .filter(block => block.rawLines.length > 0 || block.preservedLines.length > 0);
}

function classifyPreservedSourceBlock(blockText: string): PreservedSourceBlock {
    const rawLines = blockText.split("\n");
    let documentKeys = 0;
    let ruleKeys = 0;
    const preservedLines: string[] = [];

    for (const line of rawLines) {
        const key = extractRecognizedKey(line);
        if (!key) {
            preservedLines.push(line);
            continue;
        }

        if (DOCUMENT_KEYS.has(key)) {
            documentKeys += 1;
            continue;
        }

        if (RULE_KEYS.has(key)) {
            ruleKeys += 1;
            continue;
        }

        preservedLines.push(line);
    }

    if (ruleKeys > 0) {
        return {
            kind: "rule",
            preservedLines,
            rawLines
        };
    }

    if (documentKeys > 0) {
        return {
            kind: "document",
            preservedLines,
            rawLines
        };
    }

    return {
        kind: "unmanaged",
        preservedLines,
        rawLines
    };
}

function extractRecognizedKey(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
        return null;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
        return null;
    }

    return trimmed.substring(0, separatorIndex).trim();
}
