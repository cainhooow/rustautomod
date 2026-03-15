import { AutomodRule } from "../interfaces/automodconf";
import { ModDeclaration } from "../interfaces/modeclaration";

export function buildModDeclarations(name: string, config: AutomodRule): string[] {
    const visibility = config.visibility === "private" ? "mod" : "pub mod";
    const modLine = `${visibility} ${name};`;

    if (!config.cfg || config.cfg.length === 0) {
        return [modLine];
    }

    return config.cfg.flatMap(condition => [`#[cfg(${condition})]`, modLine]);
}

export function parseModDeclarations(lines: string[]): ModDeclaration[] {
    const modDeclarations: ModDeclaration[] = [];

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        const instructionOnly = trimmed.split("//")[0].trim();

        if ((instructionOnly.startsWith("mod ") || instructionOnly.startsWith("pub mod ")) && instructionOnly.endsWith(";")) {
            const attributes: string[] = [];
            const fullBlock: string[] = [];
            let startIndex = i;

            let j = i - 1;
            while (j >= 0) {
                const previousTrimmed = lines[j].trim();
                if (previousTrimmed.startsWith("#[") || previousTrimmed.startsWith("#!")) {
                    attributes.unshift(lines[j]);
                    fullBlock.unshift(lines[j]);
                    startIndex = j;
                    j--;
                } else if (previousTrimmed === "" || previousTrimmed.startsWith("//")) {
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

export function extractModuleName(modLine: string): string {
    const match = modLine.match(/(?:pub\s+)?mod\s+(\w+)/);
    return match ? match[1] : "";
}
