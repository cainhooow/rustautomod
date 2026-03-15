import path from "path";

export type FilesExcludeValue = boolean | { when?: string };

export interface WorkspaceModVisibilityState {
    autoHideIndexModRs: boolean;
    manuallyHidden: string[];
    preservedExcludes: string[];
    lastAppliedExcludes: string[];
}

export interface ReconcileManagedExcludesResult {
    excludes: Record<string, FilesExcludeValue>;
    preservedExcludes: string[];
    lastAppliedExcludes: string[];
}

const INDEX_LIKE_STATEMENT_PATTERN = /^(?:#\s*!?\[[\s\S]*?\]\s*)*(?:(?:pub(?:\s*\([^)]*\))?\s+)?mod\s+[A-Za-z_][A-Za-z0-9_]*\s*;|pub(?:\s*\([^)]*\))?\s+use\s+[\s\S]+;)$/s;

export function createDefaultWorkspaceModVisibilityState(): WorkspaceModVisibilityState {
    return {
        autoHideIndexModRs: false,
        manuallyHidden: [],
        preservedExcludes: [],
        lastAppliedExcludes: []
    };
}

export function normalizeGlobPath(filePath: string): string {
    return filePath.replace(/\\/g, "/");
}

export function toRelativeExcludePattern(workspaceFolderPath: string, filePath: string): string {
    return normalizeGlobPath(path.relative(workspaceFolderPath, filePath));
}

export function isIndexLikeModRsContent(content: string): boolean {
    const withoutComments = stripRustComments(content).trim();

    if (!withoutComments) {
        return false;
    }

    const segments = withoutComments.split(";");
    const trailingSegment = segments.pop()?.trim() ?? "";
    let foundAllowedStatement = false;

    for (const segment of segments) {
        const trimmedSegment = segment.trim();
        if (!trimmedSegment) {
            continue;
        }

        const statement = `${trimmedSegment};`;
        if (!INDEX_LIKE_STATEMENT_PATTERN.test(statement)) {
            return false;
        }

        foundAllowedStatement = true;
    }

    return foundAllowedStatement && trailingSegment.length === 0;
}

export function reconcileManagedExcludes(
    currentExcludes: Record<string, FilesExcludeValue>,
    desiredPatterns: Iterable<string>,
    state: Pick<WorkspaceModVisibilityState, "lastAppliedExcludes" | "preservedExcludes">
): ReconcileManagedExcludesResult {
    const nextExcludes = { ...currentExcludes };
    const nextDesiredPatterns = new Set(
        Array.from(desiredPatterns)
            .map(pattern => pattern.trim())
            .filter(Boolean)
    );
    const lastAppliedPatterns = new Set(state.lastAppliedExcludes);
    const preservedPatterns = new Set(state.preservedExcludes);

    for (const pattern of lastAppliedPatterns) {
        if (nextDesiredPatterns.has(pattern)) {
            continue;
        }

        if (!preservedPatterns.has(pattern)) {
            delete nextExcludes[pattern];
        }

        preservedPatterns.delete(pattern);
    }

    for (const pattern of nextDesiredPatterns) {
        if (!lastAppliedPatterns.has(pattern) && Object.prototype.hasOwnProperty.call(currentExcludes, pattern)) {
            preservedPatterns.add(pattern);
        }

        nextExcludes[pattern] = true;
    }

    return {
        excludes: nextExcludes,
        preservedExcludes: Array.from(preservedPatterns).sort(),
        lastAppliedExcludes: Array.from(nextDesiredPatterns).sort()
    };
}

function stripRustComments(content: string): string {
    const withoutBlockComments = content.replace(/\/\*[\s\S]*?\*\//g, "");
    return withoutBlockComments.replace(/\/\/.*$/gm, "");
}
