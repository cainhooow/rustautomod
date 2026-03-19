import path from "path";
import { promises as fs } from "fs";
import * as vscode from "vscode";
import {
    AutomodConfigDocument
} from "../interfaces/automodconf";
import {
    resolveRautomodDocumentAsync
} from "../automod/automodConfigFile";
import { collectWorkspaceModuleTree, createEmptyWorkspaceModuleTree } from "./studio/rautomodModuleTreeService";
import {
    AnalyzedConfig,
    analyzeRautomodConfigDocument,
    evaluatePlaygroundPath
} from "./studio/rautomodConfigAnalysisService";
import { getRautomodStudioCacheVersion } from "./studio/rautomodStudioCacheService";
import type {
    RautomodEditorInsights,
    RautomodManagerConfigSummary,
    RautomodManagerState,
    RautomodPlaygroundResult
} from "./studio/rautomodStudioTypes";

export type {
    RautomodAuditIssue,
    RautomodConfigAuditSummary,
    RautomodEditorInsights,
    RautomodImpactItem,
    RautomodImpactPreview,
    RautomodManagerConfigSummary,
    RautomodManagerState,
    RautomodModuleTreeNode,
    RautomodPlaygroundResult,
    RautomodPlaygroundRuleDetail,
    RautomodWorkspaceModuleTree
} from "./studio/rautomodStudioTypes";

interface CachedDocumentEntry {
    rawText: string;
    value: AutomodConfigDocument;
}

let activeCacheVersion = -1;
let cachedManagerState: {
    version: number;
    workspaceSignature: string;
    value: RautomodManagerState;
} | null = null;
const parsedDocumentCache = new Map<string, CachedDocumentEntry>();

export async function collectRautomodEditorInsights(
    documentUri: vscode.Uri,
    rawText: string,
    playgroundInput?: string
): Promise<RautomodEditorInsights> {
    const document = await resolveCachedRautomodDocument(rawText, documentUri.fsPath);
    const analysis = await analyzeRautomodConfigDocument(documentUri.fsPath, rawText, document);

    return {
        impact: analysis.impact,
        audit: analysis.audit,
        playground: playgroundInput?.trim()
            ? await evaluatePlaygroundPath(documentUri.fsPath, rawText, document, analysis.nestedConfigPaths, playgroundInput)
            : null
    };
}

export async function collectRautomodManagerState(): Promise<RautomodManagerState> {
    const cacheVersion = syncStudioServiceCaches();
    const workspaceFolders = (vscode.workspace.workspaceFolders ?? []).map(folder => ({
        name: folder.name,
        uri: folder.uri.toString()
    }));
    const workspaceSignature = JSON.stringify(workspaceFolders);

    if (cachedManagerState
        && cachedManagerState.version === cacheVersion
        && cachedManagerState.workspaceSignature === workspaceSignature) {
        return cachedManagerState.value;
    }

    const uris = await vscode.workspace.findFiles(
        "**/.rautomod",
        "**/{node_modules,target,.git,out,dist,build}/**"
    );

    const configs = await Promise.all(uris.map(async uri => {
        const rawText = await readUtf8File(uri.fsPath);
        const document = await resolveCachedRautomodDocument(rawText, uri.fsPath);
        const analysis = await analyzeRautomodConfigDocument(uri.fsPath, rawText, document);
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);

        return createManagerConfigSummary(uri, workspaceFolder, document, analysis);
    }));

    configs.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

    const value: RautomodManagerState = {
        configs,
        workspaceFolders,
        auditSummary: {
            invalidConfigs: configs.filter(config => config.diagnosticCount > 0).length,
            duplicateRules: configs.reduce((sum, config) => sum + config.audit.duplicateRuleCount, 0),
            unusedRules: configs.reduce((sum, config) => sum + config.audit.unusedRuleCount, 0),
            overlaps: configs.reduce((sum, config) => sum + config.audit.overlapCount, 0),
            ignoredFiles: configs.reduce((sum, config) => sum + config.audit.ignoredFileCount, 0),
            shadowedFiles: configs.reduce((sum, config) => sum + config.audit.shadowedFileCount, 0),
            uncoveredFiles: configs.reduce((sum, config) => sum + config.audit.uncoveredFileCount, 0)
        },
        moduleTree: await Promise.all((vscode.workspace.workspaceFolders ?? []).map(async workspaceFolder => {
            try {
                return await collectWorkspaceModuleTree(workspaceFolder);
            } catch (error) {
                if (isMissingPathError(error)) {
                    return createEmptyWorkspaceModuleTree(workspaceFolder);
                }

                throw error;
            }
        }))
    };

    cachedManagerState = {
        version: cacheVersion,
        workspaceSignature,
        value
    };

    return value;
}

export async function collectManagerPlaygroundResult(
    configUri: vscode.Uri,
    inputPath: string
): Promise<RautomodPlaygroundResult> {
    const rawText = await readUtf8File(configUri.fsPath);
    const document = await resolveCachedRautomodDocument(rawText, configUri.fsPath);
    const analysis = await analyzeRautomodConfigDocument(configUri.fsPath, rawText, document);
    return evaluatePlaygroundPath(configUri.fsPath, rawText, document, analysis.nestedConfigPaths, inputPath);
}

function syncStudioServiceCaches(): number {
    const currentCacheVersion = getRautomodStudioCacheVersion();
    if (activeCacheVersion === currentCacheVersion) {
        return currentCacheVersion;
    }

    activeCacheVersion = currentCacheVersion;
    cachedManagerState = null;
    parsedDocumentCache.clear();
    return currentCacheVersion;
}

async function resolveCachedRautomodDocument(rawText: string, filePath: string): Promise<AutomodConfigDocument> {
    syncStudioServiceCaches();
    const cacheKey = path.normalize(filePath);
    const cached = parsedDocumentCache.get(cacheKey);
    if (cached && cached.rawText === rawText) {
        return cached.value;
    }

    const value = await resolveRautomodDocumentAsync(rawText, filePath);
    parsedDocumentCache.set(cacheKey, {
        rawText,
        value
    });
    return value;
}

function createManagerConfigSummary(
    uri: vscode.Uri,
    workspaceFolder: vscode.WorkspaceFolder | undefined,
    document: AutomodConfigDocument,
    analysis: AnalyzedConfig
): RautomodManagerConfigSummary {
    return {
        uri: uri.toString(),
        fileName: path.basename(uri.fsPath),
        workspaceName: workspaceFolder?.name,
        relativePath: workspaceFolder
            ? normalizePath(path.relative(workspaceFolder.uri.fsPath, uri.fsPath))
            : uri.fsPath,
        folderUri: vscode.Uri.file(path.dirname(uri.fsPath)).toString(),
        folderPath: path.dirname(uri.fsPath),
        ruleCount: document.rules.length,
        diagnosticCount: document.diagnostics.length,
        strictMode: document.strictMode,
        schemaVersion: document.schemaVersion,
        extendsCount: document.extendsPaths.length,
        targetModes: Array.from(new Set(document.rules.map(rule => rule.target ?? "auto"))),
        impact: {
            totalRustFiles: analysis.impact.totalRustFiles,
            matchedCount: analysis.impact.matchedCount,
            ignoredCount: analysis.impact.ignoredCount,
            shadowedCount: analysis.impact.shadowedCount,
            uncoveredCount: analysis.impact.uncoveredCount,
            sampleItems: analysis.impact.items.slice(0, 6)
        },
        audit: {
            issueCount: analysis.audit.issueCount,
            invalidCount: analysis.audit.invalidCount,
            duplicateRuleCount: analysis.audit.duplicateRuleCount,
            unusedRuleCount: analysis.audit.unusedRuleCount,
            overlapCount: analysis.audit.overlapCount,
            ignoredFileCount: analysis.audit.ignoredFileCount,
            shadowedFileCount: analysis.audit.shadowedFileCount,
            uncoveredFileCount: analysis.audit.uncoveredFileCount,
            topIssues: analysis.audit.issues.slice(0, 6)
        }
    };
}

async function readUtf8File(filePath: string): Promise<string> {
    return fs.readFile(filePath, "utf8");
}

function isMissingPathError(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && (error as { code?: string }).code === "ENOENT";
}

function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, "/");
}
