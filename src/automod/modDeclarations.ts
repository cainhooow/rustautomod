import { AutomodRule, AutomodVisibility } from "../interfaces/automodconf";
import { ManagedDeclaration, ModDeclaration } from "../interfaces/modeclaration";

export function buildModDeclarations(name: string, config: AutomodRule): string[] {
    const modLines = buildAttributedLines(config.cfg, buildModuleLine(name, config.visibility));

    if (config.reexport !== "enabled") {
        return modLines;
    }

    const reexportLines = buildAttributedLines(config.cfg, `pub use self::${name}::*;`);
    return [...modLines, ...reexportLines];
}

export function parseModDeclarations(lines: string[]): ModDeclaration[] {
    return parseManagedDeclarations(lines)
        .filter(declaration => declaration.kind === "mod")
        .map(declaration => ({
            attributes: declaration.attributes,
            modLine: declaration.line,
            fullBlock: declaration.fullBlock,
            startIndex: declaration.startIndex,
            endIndex: declaration.endIndex
        }));
}

export function parseManagedDeclarations(lines: string[]): ManagedDeclaration[] {
    const declarations: ManagedDeclaration[] = [];

    for (let index = 0; index < lines.length; index++) {
        const currentLine = lines[index].trim();
        const instructionOnly = currentLine.split("//")[0].trim();

        if (instructionOnly === "") {
            continue;
        }

        if (isModDeclarationLine(instructionOnly)) {
            declarations.push(buildManagedDeclaration(lines, index, "mod"));
            continue;
        }

        if (isReexportLine(instructionOnly)) {
            declarations.push(buildManagedDeclaration(lines, index, "pub_use"));
        }
    }

    return declarations;
}

export function extractModuleName(modLine: string): string {
    return extractModuleNameFromLine(modLine);
}

export function isModDeclarationLine(line: string): boolean {
    return /^(?:pub(?:\((?:crate|super)\))?\s+)?mod\s+\w+\s*;$/.test(line);
}

export function isReexportLine(line: string): boolean {
    return /^pub\s+use\s+self::\w+::\*\s*;$/.test(line);
}

function buildManagedDeclaration(lines: string[], index: number, kind: ManagedDeclaration["kind"]): ManagedDeclaration {
    const attributes: string[] = [];
    const fullBlock: string[] = [];
    let startIndex = index;

    let cursor = index - 1;
    while (cursor >= 0) {
        const previousTrimmed = lines[cursor].trim();
        if (previousTrimmed.startsWith("#[")) {
            attributes.unshift(lines[cursor]);
            fullBlock.unshift(lines[cursor]);
            startIndex = cursor;
            cursor--;
            continue;
        }

        if (previousTrimmed === "") {
            cursor--;
            continue;
        }

        break;
    }

    fullBlock.push(lines[index]);

    const line = lines[index];
    return {
        kind,
        attributes,
        line,
        fullBlock,
        startIndex,
        endIndex: index,
        moduleName: extractModuleNameFromLine(line),
        visibility: kind === "mod" ? extractVisibility(line) : undefined,
        hasCfg: attributes.length > 0
    };
}

function buildAttributedLines(cfgValues: string[] | undefined, line: string): string[] {
    if (!cfgValues || cfgValues.length === 0) {
        return [line];
    }

    return cfgValues.flatMap(condition => [`#[cfg(${condition})]`, line]);
}

function buildModuleLine(name: string, visibility: AutomodVisibility): string {
    if (visibility === "private") {
        return `mod ${name};`;
    }

    return `${visibility} mod ${name};`;
}

function extractModuleNameFromLine(line: string): string {
    const modMatch = line.match(/(?:pub(?:\((?:crate|super)\))?\s+)?mod\s+(\w+)/);
    if (modMatch) {
        return modMatch[1];
    }

    const reexportMatch = line.match(/pub\s+use\s+self::(\w+)::\*/);
    return reexportMatch ? reexportMatch[1] : "";
}

function extractVisibility(line: string): AutomodVisibility {
    const trimmed = line.trim();
    if (trimmed.startsWith("pub(crate) mod ")) {
        return "pub(crate)";
    }

    if (trimmed.startsWith("pub(super) mod ")) {
        return "pub(super)";
    }

    if (trimmed.startsWith("pub mod ")) {
        return "pub";
    }

    return "private";
}
