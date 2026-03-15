export function smartSplitCfg(value: string): string[] {
    const parts: string[] = [];
    let currentPart = "";
    let parenDepth = 0;

    for (const char of value) {
        if (char === "(") {
            parenDepth++;
        } else if (char === ")") {
            parenDepth--;
        }

        if (char === "," && parenDepth === 0) {
            parts.push(currentPart.trim());
            currentPart = "";
        } else {
            currentPart += char;
        }
    }

    parts.push(currentPart.trim());
    return parts.filter(Boolean);
}
