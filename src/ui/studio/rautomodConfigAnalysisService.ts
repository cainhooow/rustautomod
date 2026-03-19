import path from "path";
import { Dirent, promises as fs } from "fs";
import * as vscode from "vscode";
import {
    AutomodConfigDocument,
    AutomodRule,
    ResolvedAutomodConfig
} from "../../interfaces/automodconf";
import {
    evaluateAutomodRule,
    resolveConfigForFileFromDocument
} from "../../automod/automodConfigFile";
import { buildModDeclarations } from "../../automod/modDeclarations";
import {
    fileExists,
    isSpecialRustFile,
    resolveModuleRegistrationFileForTarget
} from "../../automod/modFileSystem";
import { isBlacklistedPath } from "../../utils/pathValidator";
import {
    RautomodAuditIssue,
    RautomodConfigAuditSummary,
    RautomodImpactItem,
    RautomodImpactPreview,
    RautomodPlaygroundResult,
    RautomodPlaygroundRuleDetail
} from "./rautomodStudioTypes";
import { getRautomodStudioCacheVersion } from "./rautomodStudioCacheService";

export interface AnalyzedConfig {
    impact: RautomodImpactPreview;
    audit: RautomodConfigAuditSummary;
    nestedConfigPaths: string[];
}

interface TextCacheEntry<T> {
    rawText: string;
    value: T;
}

let activeCacheVersion = -1;
const analysisCache = new Map<string, TextCacheEntry<AnalyzedConfig>>();
const playgroundCache = new Map<string, RautomodPlaygroundResult>();
const nestedConfigCache = new Map<string, string[]>();
const rustFilesCache = new Map<string, string[]>();
const targetFileCache = new Map<string, string | null>();

export async function analyzeRautomodConfigDocument(
    configPath: string,
    rawText: string,
    document: AutomodConfigDocument
): Promise<AnalyzedConfig> {
    resetCachesIfNeeded();

    const cached = analysisCache.get(configPath);
    if (cached && cached.rawText === rawText) {
        return cached.value;
    }

    const folderPath = path.dirname(configPath);
    const nestedConfigPaths = await collectNestedConfigPaths(folderPath, configPath);
    const rustFiles = await collectRustFilesUnder(folderPath);
    const impactItems: RautomodImpactItem[] = [];
    const overlapIssues: RautomodAuditIssue[] = [];
    const usedRuleIndexes = new Set<number>();
    let matchedCount = 0;
    let ignoredCount = 0;
    let shadowedCount = 0;
    let uncoveredCount = 0;

    for (const rustFilePath of rustFiles) {
        const shadowedBy = findShadowingConfigPath(rustFilePath, configPath, nestedConfigPaths);
        if (shadowedBy) {
            impactItems.push({
                fileUri: vscode.Uri.file(rustFilePath).toString(),
                folderUri: vscode.Uri.file(path.dirname(rustFilePath)).toString(),
                relativePath: normalizePath(path.relative(folderPath, rustFilePath)),
                status: "shadowed",
                reason: "A nested .rautomod is closer to this file.",
                winnerRuleIndex: null,
                matchedPatterns: [],
                previewLines: [],
                shadowedByConfigUri: vscode.Uri.file(shadowedBy).toString()
            });
            shadowedCount += 1;
            continue;
        }

        const resolved = resolveConfigForFileFromDocument(document, rustFilePath);
        const matchingRuleCount = countMatchingRules(document, rustFilePath);
        if (matchingRuleCount > 1) {
            overlapIssues.push({
                severity: "warning",
                kind: "overlap",
                message: `${normalizePath(path.relative(folderPath, rustFilePath))} matches ${matchingRuleCount} rules; the first one wins.`,
                fileUri: vscode.Uri.file(rustFilePath).toString()
            });
        }

        if (!resolved) {
            impactItems.push({
                fileUri: vscode.Uri.file(rustFilePath).toString(),
                folderUri: vscode.Uri.file(path.dirname(rustFilePath)).toString(),
                relativePath: normalizePath(path.relative(folderPath, rustFilePath)),
                status: "uncovered",
                reason: "No rule in this .rautomod matched the file.",
                winnerRuleIndex: null,
                matchedPatterns: [],
                previewLines: []
            });
            uncoveredCount += 1;
            continue;
        }

        usedRuleIndexes.add(resolved.matchedRuleIndex);
        const impactItem = await createImpactItem(folderPath, rustFilePath, resolved);
        impactItems.push(impactItem);

        if (impactItem.status === "ignored") {
            ignoredCount += 1;
        } else {
            matchedCount += 1;
        }
    }

    const duplicateIssues = createDuplicateRuleIssues(document);
    const unusedRuleIssues = document.rules
        .map((_, index) => index)
        .filter(index => !usedRuleIndexes.has(index))
        .map(index => ({
            severity: "info" as const,
            kind: "unused_rule" as const,
            message: `Rule ${index + 1} did not win for any Rust file in this subtree.`
        }));

    const ignoredFileIssues = impactItems
        .filter(item => item.status === "ignored")
        .slice(0, 8)
        .map(item => ({
            severity: "info" as const,
            kind: "ignored_file" as const,
            message: `${item.relativePath} is ignored by exclude rules.`,
            fileUri: item.fileUri
        }));

    const shadowedFileIssues = impactItems
        .filter(item => item.status === "shadowed")
        .slice(0, 8)
        .map(item => ({
            severity: "warning" as const,
            kind: "shadowed_file" as const,
            message: `${item.relativePath} is shadowed by a nested .rautomod.`,
            fileUri: item.fileUri
        }));

    const uncoveredIssues = impactItems
        .filter(item => item.status === "uncovered")
        .slice(0, 8)
        .map(item => ({
            severity: "warning" as const,
            kind: "uncovered_file" as const,
            message: `${item.relativePath} is not covered by any rule in this .rautomod.`,
            fileUri: item.fileUri
        }));

    const diagnosticIssues = document.diagnostics.map(diagnostic => ({
        severity: diagnostic.severity === "error" ? "error" as const : "warning" as const,
        kind: "diagnostic" as const,
        message: `Line ${diagnostic.line + 1}: ${diagnostic.message}`
    }));

    const auditIssues = [
        ...diagnosticIssues,
        ...duplicateIssues,
        ...unusedRuleIssues,
        ...overlapIssues,
        ...ignoredFileIssues,
        ...shadowedFileIssues,
        ...uncoveredIssues
    ];

    const analysis: AnalyzedConfig = {
        impact: {
            totalRustFiles: rustFiles.length,
            matchedCount,
            ignoredCount,
            shadowedCount,
            uncoveredCount,
            items: impactItems.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
        },
        audit: {
            issueCount: auditIssues.length,
            invalidCount: document.diagnostics.length,
            duplicateRuleCount: duplicateIssues.length,
            unusedRuleCount: unusedRuleIssues.length,
            overlapCount: overlapIssues.length,
            ignoredFileCount: ignoredFileIssues.length,
            shadowedFileCount: shadowedFileIssues.length,
            uncoveredFileCount: uncoveredIssues.length,
            issues: auditIssues
        },
        nestedConfigPaths
    };

    analysisCache.set(configPath, {
        rawText,
        value: analysis
    });

    return analysis;
}

export async function evaluatePlaygroundPath(
    configPath: string,
    rawText: string,
    document: AutomodConfigDocument,
    nestedConfigPaths: string[],
    inputPath: string
): Promise<RautomodPlaygroundResult> {
    resetCachesIfNeeded();

    const cacheKey = JSON.stringify([
        configPath,
        rawText,
        inputPath,
        nestedConfigPaths
    ]);
    const cached = playgroundCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const baseFolder = path.dirname(configPath);
    const resolvedPath = path.isAbsolute(inputPath)
        ? path.normalize(inputPath)
        : path.normalize(path.join(baseFolder, inputPath));

    const shadowedBy = findShadowingConfigPath(resolvedPath, configPath, nestedConfigPaths);
    const ruleDetails = document.rules.map((rule, index) => {
        const evaluation = evaluateAutomodRule(rule, resolvedPath);
        return {
            ruleIndex: index,
            matched: evaluation.matched,
            ignored: evaluation.ignored,
            reason: describeRuleReason(evaluation),
            matchedPatterns: evaluation.matchedPatterns,
            summary: `${rule.visibility} / ${rule.sort} / ${rule.target ?? "auto"}`
        } satisfies RautomodPlaygroundRuleDetail;
    });

    if (shadowedBy) {
        const result: RautomodPlaygroundResult = {
            inputPath,
            resolvedPath,
            outcome: "shadowed",
            reason: "A nested .rautomod is closer to the inspected path.",
            winnerRuleIndex: null,
            matchedPatterns: [],
            previewLines: [],
            shadowedByConfigUri: vscode.Uri.file(shadowedBy).toString(),
            ruleDetails
        };
        playgroundCache.set(cacheKey, result);
        return result;
    }

    const resolved = resolveConfigForFileFromDocument(document, resolvedPath);
    if (!resolved) {
        const result: RautomodPlaygroundResult = {
            inputPath,
            resolvedPath,
            outcome: "uncovered",
            reason: "No rule matched this path in the current .rautomod.",
            winnerRuleIndex: null,
            matchedPatterns: [],
            previewLines: [],
            ruleDetails
        };
        playgroundCache.set(cacheKey, result);
        return result;
    }

    const targetFilePath = await resolveTargetFilePathForRule(path.dirname(resolvedPath), resolved.rule);
    const result: RautomodPlaygroundResult = {
        inputPath,
        resolvedPath,
        outcome: resolved.ignored ? "ignored" : "matched",
        reason: resolved.ignored
            ? "The winning rule matched, but the file is ignored by exclude patterns."
            : "The winning rule matches this path.",
        winnerRuleIndex: resolved.matchedRuleIndex,
        matchedPatterns: resolved.matchedPatterns,
        targetFilePath: targetFilePath ?? undefined,
        previewLines: buildModDeclarations(path.basename(resolvedPath, ".rs"), resolved.rule),
        ruleDetails
    };

    playgroundCache.set(cacheKey, result);
    return result;
}

function resetCachesIfNeeded(): void {
    const currentVersion = getRautomodStudioCacheVersion();
    if (activeCacheVersion === currentVersion) {
        return;
    }

    activeCacheVersion = currentVersion;
    analysisCache.clear();
    playgroundCache.clear();
    nestedConfigCache.clear();
    rustFilesCache.clear();
    targetFileCache.clear();
}

async function createImpactItem(
    rootFolderPath: string,
    rustFilePath: string,
    resolved: ResolvedAutomodConfig
): Promise<RautomodImpactItem> {
    const targetFilePath = await resolveTargetFilePathForRule(path.dirname(rustFilePath), resolved.rule);
    const previewLines = buildModDeclarations(path.basename(rustFilePath, ".rs"), resolved.rule);

    return {
        fileUri: vscode.Uri.file(rustFilePath).toString(),
        folderUri: vscode.Uri.file(path.dirname(rustFilePath)).toString(),
        relativePath: normalizePath(path.relative(rootFolderPath, rustFilePath)),
        status: resolved.ignored ? "ignored" : "matched",
        reason: resolved.ignored
            ? "The winning rule matched, but exclude patterns marked the file as ignored."
            : "The file is covered by the winning rule in this .rautomod.",
        winnerRuleIndex: resolved.matchedRuleIndex,
        matchedPatterns: resolved.matchedPatterns,
        targetFilePath: targetFilePath ?? undefined,
        targetFileUri: targetFilePath ? vscode.Uri.file(targetFilePath).toString() : undefined,
        previewLines
    };
}

function countMatchingRules(document: AutomodConfigDocument, rustFilePath: string): number {
    let matchingRuleCount = 0;

    for (const rule of document.rules) {
        if (evaluateAutomodRule(rule, rustFilePath).matched) {
            matchingRuleCount += 1;
        }
    }

    return matchingRuleCount;
}

async function collectNestedConfigPaths(rootFolderPath: string, currentConfigPath: string): Promise<string[]> {
    resetCachesIfNeeded();

    const cacheKey = `${path.normalize(rootFolderPath)}::${path.normalize(currentConfigPath)}`;
    const cached = nestedConfigCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    if (!await fileExists(rootFolderPath)) {
        nestedConfigCache.set(cacheKey, []);
        return [];
    }

    const nestedPaths: string[] = [];
    await walkDirectory(rootFolderPath, (candidatePath, entry) => {
        if (entry.isFile() && entry.name === ".rautomod" && path.normalize(candidatePath) !== path.normalize(currentConfigPath)) {
            nestedPaths.push(path.normalize(candidatePath));
        }
    });

    nestedPaths.sort();
    nestedConfigCache.set(cacheKey, nestedPaths);
    return nestedPaths;
}

async function collectRustFilesUnder(rootFolderPath: string): Promise<string[]> {
    resetCachesIfNeeded();

    const cacheKey = path.normalize(rootFolderPath);
    const cached = rustFilesCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    if (!await fileExists(rootFolderPath)) {
        rustFilesCache.set(cacheKey, []);
        return [];
    }

    const rustFiles: string[] = [];
    await walkDirectory(rootFolderPath, (candidatePath, entry) => {
        if (!entry.isFile() || !entry.name.endsWith(".rs")) {
            return;
        }

        if (isSpecialRustFile(path.basename(entry.name, ".rs"))) {
            return;
        }

        rustFiles.push(path.normalize(candidatePath));
    });

    rustFiles.sort();
    rustFilesCache.set(cacheKey, rustFiles);
    return rustFiles;
}

async function walkDirectory(
    rootFolderPath: string,
    onEntry: (candidatePath: string, entry: Dirent) => void
): Promise<void> {
    const directories = [rootFolderPath];

    while (directories.length > 0) {
        const directory = directories.pop();
        if (!directory) {
            continue;
        }

        let entries: Dirent[];
        try {
            entries = await fs.readdir(directory, { withFileTypes: true });
        } catch (error) {
            if (isMissingPathError(error)) {
                continue;
            }

            throw error;
        }

        for (const entry of entries) {
            const candidatePath = path.join(directory, entry.name);
            if (isBlacklistedPath(candidatePath)) {
                continue;
            }

            if (entry.isDirectory()) {
                directories.push(candidatePath);
                continue;
            }

            onEntry(candidatePath, entry);
        }
    }
}

async function resolveTargetFilePathForRule(folderPath: string, rule: AutomodRule): Promise<string | null> {
    resetCachesIfNeeded();

    const cacheKey = `${path.normalize(folderPath)}::${rule.target ?? "auto"}`;
    if (targetFileCache.has(cacheKey)) {
        return targetFileCache.get(cacheKey) ?? null;
    }

    const targetPath = await resolveModuleRegistrationFileForTarget(folderPath, rule.target ?? "auto");
    const resolvedPath = targetPath
        ?? ((rule.target ?? "auto") === "auto" || rule.target === "mod.rs"
            ? path.join(folderPath, "mod.rs")
            : null);

    targetFileCache.set(cacheKey, resolvedPath);
    return resolvedPath;
}

function findShadowingConfigPath(
    rustFilePath: string,
    currentConfigPath: string,
    nestedConfigPaths: string[]
): string | null {
    const currentFolder = path.dirname(path.normalize(currentConfigPath));
    const filePath = path.normalize(rustFilePath);
    let winner: string | null = null;
    let winnerLength = currentFolder.length;

    for (const nestedConfigPath of nestedConfigPaths) {
        const nestedFolder = path.dirname(path.normalize(nestedConfigPath));
        if (!isPathInside(filePath, nestedFolder)) {
            continue;
        }

        if (nestedFolder.length > winnerLength) {
            winner = nestedConfigPath;
            winnerLength = nestedFolder.length;
        }
    }

    return winner;
}

function isPathInside(filePath: string, folderPath: string): boolean {
    const relative = path.relative(folderPath, filePath);
    return relative !== ""
        && !relative.startsWith("..")
        && !path.isAbsolute(relative);
}

function createDuplicateRuleIssues(document: AutomodConfigDocument): RautomodAuditIssue[] {
    const ruleIndexBySignature = new Map<string, number>();
    const issues: RautomodAuditIssue[] = [];

    document.rules.forEach((rule, index) => {
        const signature = JSON.stringify({
            visibility: rule.visibility,
            sort: rule.sort,
            fmt: rule.fmt ?? "disabled",
            target: rule.target ?? "auto",
            pattern: rule.pattern ?? [],
            exclude: rule.exclude ?? [],
            cfg: rule.cfg ?? [],
            groupOrder: rule.groupOrder ?? [],
            blankLines: rule.blankLines ?? 1,
            reexport: rule.reexport ?? "disabled",
            header: rule.header ?? "",
            generatedComment: rule.generatedComment ?? ""
        });

        const previousIndex = ruleIndexBySignature.get(signature);
        if (previousIndex !== undefined) {
            issues.push({
                severity: "warning",
                kind: "duplicate_rule",
                message: `Rule ${index + 1} duplicates the settings of rule ${previousIndex + 1}.`
            });
            return;
        }

        ruleIndexBySignature.set(signature, index);
    });

    return issues;
}

function describeRuleReason(evaluation: ReturnType<typeof evaluateAutomodRule>): string {
    switch (evaluation.reason) {
        case "matched_default":
            return evaluation.ignored
                ? "Matched the default rule, but exclude patterns ignore the file."
                : "Matched the default rule.";
        case "matched_pattern":
            return evaluation.ignored
                ? `Matched pattern(s) ${evaluation.matchedPatterns.join(", ")}, but exclude patterns ignore the file.`
                : `Matched pattern(s) ${evaluation.matchedPatterns.join(", ")}.`;
        case "excluded_by_negative_pattern":
            return `Rejected by negative pattern(s) ${evaluation.negativePatterns.join(", ")}.`;
        case "no_positive_pattern_match":
        default:
            return "Did not match any positive pattern in this rule.";
    }
}

function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, "/");
}

function isMissingPathError(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && (error as { code?: string }).code === "ENOENT";
}
