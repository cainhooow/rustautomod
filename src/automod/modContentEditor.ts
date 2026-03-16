import { AutomodGroupOrder, AutomodRule } from "../interfaces/automodconf";
import { ManagedDeclaration } from "../interfaces/modeclaration";
import { extractModuleName, parseManagedDeclarations } from "./modDeclarations";

interface EditorOptions {
    sort: AutomodRule["sort"];
    groupOrder: AutomodGroupOrder[];
    blankLines: number;
    header?: string;
    generatedComment?: string;
}

export function addModDeclarations(
    content: string,
    newLines: string[],
    sortOrConfig: AutomodRule["sort"] | AutomodRule
): string {
    const options = normalizeEditorOptions(sortOrConfig);
    const lines = content.split(/\r?\n/);
    const existingDeclarations = parseManagedDeclarations(lines);
    const modLine = newLines.find(line => line.includes(" mod ")) ?? "";
    const newModuleName = extractModuleName(modLine);

    if (newModuleName) {
        const alreadyExists = existingDeclarations.some(declaration =>
            declaration.kind === "mod" && declaration.moduleName === newModuleName
        );
        if (alreadyExists) {
            return content;
        }
    }

    const insertionIndex = findInsertionPoint(lines, options.groupOrder);
    const nextLines = [...lines];
    nextLines.splice(insertionIndex, 0, ...newLines);

    return reflowManagedDeclarations(joinPreservingTrailingNewline(content, nextLines), options);
}

export function removeModDeclarations(content: string, moduleName: string): string {
    const lines = content.split(/\r?\n/);
    const declarations = parseManagedDeclarations(lines)
        .filter(declaration => declaration.moduleName === moduleName);

    if (declarations.length === 0) {
        return content;
    }

    for (let index = declarations.length - 1; index >= 0; index--) {
        const declaration = declarations[index];
        const removeCount = declaration.endIndex - declaration.startIndex + 1;
        lines.splice(declaration.startIndex, removeCount);
    }

    return cleanupEmptyLines(joinPreservingTrailingNewline(content, lines), content.endsWith("\n"));
}

export function sortModDeclarationsInContent(
    content: string,
    rule?: Partial<AutomodRule>
): string {
    return reflowManagedDeclarations(content, normalizeEditorOptions(rule));
}

export function extractManagedDeclarationSignature(content: string): string {
    const lines = content.split(/\r?\n/);
    const declarations = parseManagedDeclarations(lines);
    return declarations
        .map(declaration => declaration.fullBlock.join("\n"))
        .join("\n");
}

function reflowManagedDeclarations(content: string, options: EditorOptions): string {
    const lines = content.split(/\r?\n/);
    const declarations = parseManagedDeclarations(lines);
    if (declarations.length === 0) {
        return maybeAddHeader(cleanupEmptyLines(content, content.endsWith("\n")), options.header);
    }

    const generatedCommentLine = toCommentLine(options.generatedComment);
    const preservedLines = filterOutManagedDeclarations(lines, declarations, generatedCommentLine);
    const insertionIndex = findInsertionPoint(preservedLines, options.groupOrder);
    const sortedDeclarations = sortDeclarations(declarations, options);
    const managedLines = buildManagedLines(sortedDeclarations, options.blankLines, generatedCommentLine);
    const nextLines = [...preservedLines];
    nextLines.splice(insertionIndex, 0, ...managedLines);

    const withHeader = maybeAddHeader(joinPreservingTrailingNewline(content, nextLines), options.header);
    return cleanupEmptyLines(withHeader, content.endsWith("\n"));
}

function buildManagedLines(
    declarations: ManagedDeclaration[],
    blankLines: number,
    generatedCommentLine?: string
): string[] {
    const lines: string[] = [];
    let previousGroup: string | null = null;

    if (generatedCommentLine) {
        lines.push(generatedCommentLine);
    }

    for (const declaration of declarations) {
        const group = getDeclarationGroup(declaration);
        if (previousGroup !== null && group !== previousGroup) {
            pushBlankLines(lines, blankLines);
        }

        lines.push(...declaration.fullBlock);
        previousGroup = group;
    }

    return lines;
}

function sortDeclarations(declarations: ManagedDeclaration[], options: EditorOptions): ManagedDeclaration[] {
    const groupOrder = options.groupOrder.filter((group): group is Exclude<AutomodGroupOrder, "use"> => group !== "use");

    return [...declarations].sort((left, right) => {
        const groupDelta = groupOrder.indexOf(getDeclarationGroup(left)) - groupOrder.indexOf(getDeclarationGroup(right));
        if (groupDelta !== 0) {
            return groupDelta;
        }

        if (options.sort === "none") {
            return left.startIndex - right.startIndex;
        }

        if (options.sort === "pub_first") {
            const leftWeight = left.kind === "mod" && left.visibility !== "private" ? 0 : 1;
            const rightWeight = right.kind === "mod" && right.visibility !== "private" ? 0 : 1;
            if (leftWeight !== rightWeight) {
                return leftWeight - rightWeight;
            }
        }

        if (options.sort === "cfg_first") {
            const leftWeight = left.hasCfg ? 0 : 1;
            const rightWeight = right.hasCfg ? 0 : 1;
            if (leftWeight !== rightWeight) {
                return leftWeight - rightWeight;
            }
        }

        if (options.sort === "alpha_case_insensitive") {
            const leftName = left.moduleName.toLowerCase();
            const rightName = right.moduleName.toLowerCase();
            return leftName.localeCompare(rightName) || left.moduleName.localeCompare(right.moduleName);
        }

        return left.moduleName.localeCompare(right.moduleName);
    });
}

function filterOutManagedDeclarations(
    lines: string[],
    declarations: ManagedDeclaration[],
    generatedCommentLine?: string
): string[] {
    const nextLines = [...lines];

    for (let index = declarations.length - 1; index >= 0; index--) {
        const declaration = declarations[index];
        const removeCount = declaration.endIndex - declaration.startIndex + 1;
        nextLines.splice(declaration.startIndex, removeCount);
    }

    if (generatedCommentLine) {
        for (let index = nextLines.length - 1; index >= 0; index--) {
            if (nextLines[index].trim() === generatedCommentLine) {
                nextLines.splice(index, 1);
            }
        }
    }

    while (nextLines.length > 0 && nextLines[0].trim() === "") {
        nextLines.shift();
    }

    while (nextLines.length > 0 && nextLines[nextLines.length - 1].trim() === "") {
        nextLines.pop();
    }

    return nextLines;
}

function findInsertionPoint(lines: string[], groupOrder: AutomodGroupOrder[]): number {
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

    const useBlock = findUseBlock(lines, afterHeaderIndex);
    if (useBlock.end < 0) {
        return afterHeaderIndex;
    }

    const useOrder = groupOrder.indexOf("use");
    const firstManagedOrder = Math.min(...groupOrder.filter(group => group !== "use").map(group => groupOrder.indexOf(group)));

    if (useOrder <= firstManagedOrder) {
        let insertIndex = useBlock.end + 1;
        while (insertIndex < lines.length && lines[insertIndex].trim() === "") {
            insertIndex++;
        }
        return insertIndex;
    }

    return useBlock.start;
}

function findUseBlock(lines: string[], afterHeaderIndex: number): { start: number, end: number } {
    let start = -1;
    let end = -1;
    let braceDepth = 0;
    let inUseStatement = false;

    for (let index = afterHeaderIndex; index < lines.length; index++) {
        const trimmed = lines[index].trim();

        if (trimmed.startsWith("use ")) {
            if (start === -1) {
                start = index;
            }

            inUseStatement = true;
            braceDepth = 0;
            updateBraceDepth(trimmed, delta => {
                braceDepth += delta;
            });

            if (trimmed.endsWith(";") && braceDepth === 0) {
                end = index;
                inUseStatement = false;
            }

            continue;
        }

        if (inUseStatement) {
            updateBraceDepth(trimmed, delta => {
                braceDepth += delta;
            });

            if (trimmed.endsWith(";") && braceDepth === 0) {
                end = index;
                inUseStatement = false;
            }
            continue;
        }

        if (trimmed !== "" && !trimmed.startsWith("//") && !trimmed.startsWith("/*")) {
            break;
        }
    }

    return { start, end };
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

function normalizeEditorOptions(sortOrConfig?: AutomodRule["sort"] | Partial<AutomodRule>): EditorOptions {
    if (typeof sortOrConfig === "string") {
        return {
            sort: sortOrConfig,
            groupOrder: ["use", "cfg", "pub_mod", "mod", "pub_use"],
            blankLines: 1
        };
    }

    return {
        sort: sortOrConfig?.sort ?? "alpha",
        groupOrder: sortOrConfig?.groupOrder ?? ["use", "cfg", "pub_mod", "mod", "pub_use"],
        blankLines: Math.max(0, sortOrConfig?.blankLines ?? 1),
        header: sortOrConfig?.header,
        generatedComment: sortOrConfig?.generatedComment
    };
}

function maybeAddHeader(content: string, header?: string): string {
    if (!header || content.trim() === "") {
        if (!header) {
            return content;
        }

        return `${toCommentLine(header)}\n`;
    }

    const headerLine = toCommentLine(header);
    if (content.startsWith(`${headerLine}\n`) || content === headerLine) {
        return content;
    }

    return `${headerLine}\n${content}`;
}

function toCommentLine(comment: string | undefined): string | undefined {
    if (!comment?.trim()) {
        return undefined;
    }

    const trimmed = comment.trim();
    return trimmed.startsWith("//") ? trimmed : `// ${trimmed}`;
}

function getDeclarationGroup(declaration: ManagedDeclaration): Exclude<AutomodGroupOrder, "use"> {
    if (declaration.kind === "pub_use") {
        return "pub_use";
    }

    if (declaration.hasCfg) {
        return "cfg";
    }

    return declaration.visibility === "private" ? "mod" : "pub_mod";
}

function pushBlankLines(lines: string[], count: number): void {
    for (let index = 0; index < count; index++) {
        if (lines[lines.length - 1] !== "") {
            lines.push("");
        }
    }
}

function cleanupEmptyLines(content: string, preserveTrailingNewline = false): string {
    const lines = content.split("\n");

    while (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
    }

    const joined = lines.join("\n");
    if (joined !== "" && preserveTrailingNewline) {
        return `${joined}\n`;
    }

    return joined;
}

function joinPreservingTrailingNewline(originalContent: string, lines: string[]): string {
    const joined = lines.join("\n");
    if (originalContent.endsWith("\n") || joined === "") {
        return joined;
    }

    return joined;
}
