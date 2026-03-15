import { AutomodRule } from "../interfaces/automodconf";
import { parseModDeclarations, extractModuleName } from "./modDeclarations";

export function addModDeclarations(
    content: string,
    newLines: string[],
    sortMode: AutomodRule["sort"]
): string {
    const lines = content.split(/\r?\n/);
    const existingMods = parseModDeclarations(lines);
    const modLine = newLines.find(line => line.includes("mod ")) ?? "";
    const newModuleName = extractModuleName(modLine);

    if (newModuleName) {
        const exists = existingMods.some(mod => extractModuleName(mod.modLine) === newModuleName);
        if (exists) {
            return content;
        }
    }

    let insertIndex = existingMods.length > 0
        ? existingMods[existingMods.length - 1].endIndex + 1
        : findInsertionPoint(lines);

    if (
        existingMods.length === 0
        &&
        insertIndex > 0
        && lines[insertIndex - 1].trim() !== ""
        && !lines[insertIndex - 1].trim().startsWith("use ")
    ) {
        lines.splice(insertIndex, 0, "");
        insertIndex++;
    }

    lines.splice(insertIndex, 0, ...newLines);

    if (sortMode === "alpha") {
        sortModDeclarationLines(lines);
    }

    return joinPreservingTrailingNewline(content, lines);
}

export function removeModDeclarations(content: string, moduleName: string): string {
    const lines = content.split(/\r?\n/);
    const modDeclarations = parseModDeclarations(lines);
    const declarationsToRemove = modDeclarations.filter(mod => extractModuleName(mod.modLine) === moduleName);

    if (declarationsToRemove.length === 0) {
        return content;
    }

    for (let i = declarationsToRemove.length - 1; i >= 0; i--) {
        const declaration = declarationsToRemove[i];
        const removeCount = declaration.endIndex - declaration.startIndex + 1;
        lines.splice(declaration.startIndex, removeCount);
    }

    return joinPreservingTrailingNewline(content, lines);
}

export function sortModDeclarationsInContent(content: string): string {
    const lines = content.split(/\r?\n/);
    sortModDeclarationLines(lines);
    return joinPreservingTrailingNewline(content, lines);
}

function findInsertionPoint(lines: string[]): number {
    let afterHeaderIndex = 0;

    while (
        afterHeaderIndex < lines.length
        && (
            lines[afterHeaderIndex].trim().startsWith("//!")
            || lines[afterHeaderIndex].trim().startsWith("/*!")
            || lines[afterHeaderIndex].trim().startsWith("#!")
            || lines[afterHeaderIndex].trim() === ""
        )
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
            updateBraceDepth(trimmed, value => {
                braceDepth += value;
            });

            if (trimmed.endsWith(";") && braceDepth === 0) {
                useBlockEnd = i;
                inUseStatement = false;
            }
        } else if (inUseStatement) {
            updateBraceDepth(trimmed, value => {
                braceDepth += value;
            });

            if (trimmed.endsWith(";") && braceDepth === 0) {
                useBlockEnd = i;
                inUseStatement = false;
            }
        } else if (trimmed !== "" && !trimmed.startsWith("//") && !trimmed.startsWith("/*")) {
            break;
        }
    }

    if (useBlockEnd >= 0) {
        let insertIndex = useBlockEnd + 1;
        while (insertIndex < lines.length && lines[insertIndex].trim() === "") {
            insertIndex++;
        }
        return insertIndex;
    }

    return afterHeaderIndex;
}

function sortModDeclarationLines(lines: string[]): void {
    const modDeclarations = parseModDeclarations(lines);

    if (modDeclarations.length <= 1) {
        return;
    }

    const insertionIndex = modDeclarations[0].startIndex;
    const sortedDeclarations = [...modDeclarations].sort((left, right) => {
        const leftName = extractModuleName(left.modLine);
        const rightName = extractModuleName(right.modLine);
        return leftName.localeCompare(rightName);
    });

    for (let i = modDeclarations.length - 1; i >= 0; i--) {
        const declaration = modDeclarations[i];
        const removeCount = declaration.endIndex - declaration.startIndex + 1;
        lines.splice(declaration.startIndex, removeCount);
    }

    const newBlockContent = sortedDeclarations.flatMap(declaration => declaration.fullBlock);
    lines.splice(insertionIndex, 0, ...newBlockContent);
}

function joinPreservingTrailingNewline(originalContent: string, lines: string[]): string {
    void originalContent;
    return lines.join("\n");
}

function updateBraceDepth(line: string, update: (delta: number) => void): void {
    for (const character of line) {
        if (character === "{") {
            update(1);
        } else if (character === "}") {
            update(-1);
        }
    }
}
