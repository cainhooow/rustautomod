import path from "path";
import { promises as fs } from "fs";
import * as vscode from "vscode";
import {
    AutomodConfigDocument,
    AutomodRule,
    ResolvedAutomodConfig
} from "../interfaces/automodconf";
import {
    evaluateAutomodRule,
    resolveConfigForFileFromDocument,
    resolveRautomodDocumentAsync
} from "../automod/automodConfigFile";
import { buildModDeclarations } from "../automod/modDeclarations";
import {
    fileExists,
    isSpecialRustFile,
    isModulePairRegistrationFile,
    resolveSourceDirectoryForRegistrationFile,
    resolveModuleRegistrationFileForTarget
} from "../automod/modFileSystem";
import { isBlacklistedPath } from "../utils/pathValidator";
import { parseManagedDeclarations } from "../automod/modDeclarations";

export interface RautomodImpactItem {
    fileUri: string;
    folderUri: string;
    relativePath: string;
    status: "matched" | "ignored" | "shadowed" | "uncovered";
    reason: string;
    winnerRuleIndex: number | null;
    matchedPatterns: string[];
    targetFilePath?: string;
    targetFileUri?: string;
    previewLines: string[];
    shadowedByConfigUri?: string;
}

export interface RautomodImpactPreview {
    totalRustFiles: number;
    matchedCount: number;
    ignoredCount: number;
    shadowedCount: number;
    uncoveredCount: number;
    items: RautomodImpactItem[];
}

export interface RautomodAuditIssue {
    severity: "info" | "warning" | "error";
    kind: "diagnostic" | "duplicate_rule" | "unused_rule" | "overlap" | "ignored_file" | "shadowed_file" | "uncovered_file";
    message: string;
    fileUri?: string;
}

export interface RautomodConfigAuditSummary {
    issueCount: number;
    invalidCount: number;
    duplicateRuleCount: number;
    unusedRuleCount: number;
    overlapCount: number;
    ignoredFileCount: number;
    shadowedFileCount: number;
    uncoveredFileCount: number;
    issues: RautomodAuditIssue[];
}

export interface RautomodPlaygroundRuleDetail {
    ruleIndex: number;
    matched: boolean;
    ignored: boolean;
    reason: string;
    matchedPatterns: string[];
    summary: string;
}

export interface RautomodPlaygroundResult {
    inputPath: string;
    resolvedPath: string;
    outcome: "matched" | "ignored" | "shadowed" | "uncovered";
    reason: string;
    winnerRuleIndex: number | null;
    matchedPatterns: string[];
    targetFilePath?: string;
    previewLines: string[];
    shadowedByConfigUri?: string;
    ruleDetails: RautomodPlaygroundRuleDetail[];
}

export interface RautomodEditorInsights {
    impact: RautomodImpactPreview;
    audit: RautomodConfigAuditSummary;
    playground: RautomodPlaygroundResult | null;
}

export interface RautomodManagerConfigSummary {
    uri: string;
    fileName: string;
    workspaceName?: string;
    relativePath: string;
    folderUri: string;
    folderPath: string;
    ruleCount: number;
    diagnosticCount: number;
    strictMode: string;
    schemaVersion: string;
    extendsCount: number;
    targetModes: string[];
    impact: Omit<RautomodImpactPreview, "items"> & { sampleItems: RautomodImpactItem[] };
    audit: Omit<RautomodConfigAuditSummary, "issues"> & { topIssues: RautomodAuditIssue[] };
}

export interface RautomodManagerState {
    configs: RautomodManagerConfigSummary[];
    workspaceFolders: Array<{ name: string, uri: string }>;
    auditSummary: {
        invalidConfigs: number;
        duplicateRules: number;
        unusedRules: number;
        overlaps: number;
        ignoredFiles: number;
        shadowedFiles: number;
        uncoveredFiles: number;
    };
    moduleTree: RautomodWorkspaceModuleTree[];
}

export interface RautomodModuleTreeNode {
    id: string;
    name: string;
    relativePath: string;
    sourceFileUri?: string;
    sourceFilePath?: string;
    declarationFileUri: string;
    visibility?: string;
    kind: "crate" | "module";
    layout: "crate_root" | "classic" | "modern" | "leaf" | "missing";
    canCreateChild: boolean;
    movableToCrateRoot: boolean;
    childContainerUri?: string;
    children: RautomodModuleTreeNode[];
}

export interface RautomodWorkspaceModuleTree {
    workspaceName: string;
    workspaceUri: string;
    roots: RautomodModuleTreeNode[];
}

export async function collectRautomodEditorInsights(
    documentUri: vscode.Uri,
    rawText: string,
    playgroundInput?: string
): Promise<RautomodEditorInsights> {
    const document = await resolveRautomodDocumentAsync(rawText, documentUri.fsPath);
    const analysis = await analyzeRautomodConfigDocument(documentUri.fsPath, document);

    return {
        impact: analysis.impact,
        audit: analysis.audit,
        playground: playgroundInput?.trim()
            ? await evaluatePlaygroundPath(documentUri.fsPath, document, analysis.nestedConfigPaths, playgroundInput)
            : null
    };
}

export async function collectRautomodManagerState(): Promise<RautomodManagerState> {
    const workspaceFolders = (vscode.workspace.workspaceFolders ?? []).map(folder => ({
        name: folder.name,
        uri: folder.uri.toString()
    }));

    const uris = await vscode.workspace.findFiles(
        "**/.rautomod",
        "**/{node_modules,target,.git,out,dist,build}/**"
    );

    const configs = await Promise.all(uris.map(async uri => {
        const rawText = (await vscode.workspace.openTextDocument(uri)).getText();
        const document = await resolveRautomodDocumentAsync(rawText, uri.fsPath);
        const analysis = await analyzeRautomodConfigDocument(uri.fsPath, document);
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);

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
        } satisfies RautomodManagerConfigSummary;
    }));

    configs.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

    return {
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
}

export async function collectManagerPlaygroundResult(
    configUri: vscode.Uri,
    inputPath: string
): Promise<RautomodPlaygroundResult> {
    const rawText = (await vscode.workspace.openTextDocument(configUri)).getText();
    const document = await resolveRautomodDocumentAsync(rawText, configUri.fsPath);
    const nestedConfigPaths = await collectNestedConfigPaths(path.dirname(configUri.fsPath), configUri.fsPath);
    return evaluatePlaygroundPath(configUri.fsPath, document, nestedConfigPaths, inputPath);
}

interface AnalyzedConfig {
    impact: RautomodImpactPreview;
    audit: RautomodConfigAuditSummary;
    nestedConfigPaths: string[];
}

async function analyzeRautomodConfigDocument(
    configPath: string,
    document: AutomodConfigDocument
): Promise<AnalyzedConfig> {
    const folderPath = path.dirname(configPath);
    const nestedConfigPaths = await collectNestedConfigPaths(folderPath, configPath);
    const rustFiles = await collectRustFilesUnder(folderPath);
    const impactItems: RautomodImpactItem[] = [];
    const overlapIssues: RautomodAuditIssue[] = [];
    const usedRuleIndexes = new Set<number>();

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
            continue;
        }

        const resolved = resolveConfigForFileFromDocument(document, rustFilePath);
        const ruleDetails = document.rules.map((rule, index) => ({
            ruleIndex: index,
            evaluation: evaluateAutomodRule(rule, rustFilePath)
        }));
        const matchingRules = ruleDetails.filter(detail => detail.evaluation.matched);
        if (matchingRules.length > 1) {
            overlapIssues.push({
                severity: "warning",
                kind: "overlap",
                message: `${normalizePath(path.relative(folderPath, rustFilePath))} matches ${matchingRules.length} rules; the first one wins.`,
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
            continue;
        }

        usedRuleIndexes.add(resolved.matchedRuleIndex);
        impactItems.push(await createImpactItem(folderPath, rustFilePath, resolved));
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

    return {
        impact: {
            totalRustFiles: rustFiles.length,
            matchedCount: impactItems.filter(item => item.status === "matched").length,
            ignoredCount: impactItems.filter(item => item.status === "ignored").length,
            shadowedCount: impactItems.filter(item => item.status === "shadowed").length,
            uncoveredCount: impactItems.filter(item => item.status === "uncovered").length,
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

async function evaluatePlaygroundPath(
    configPath: string,
    document: AutomodConfigDocument,
    nestedConfigPaths: string[],
    inputPath: string
): Promise<RautomodPlaygroundResult> {
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
        return {
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
    }

    const resolved = resolveConfigForFileFromDocument(document, resolvedPath);
    if (!resolved) {
        return {
            inputPath,
            resolvedPath,
            outcome: "uncovered",
            reason: "No rule matched this path in the current .rautomod.",
            winnerRuleIndex: null,
            matchedPatterns: [],
            previewLines: [],
            ruleDetails
        };
    }

    const targetFilePath = await resolveTargetFilePathForRule(path.dirname(resolvedPath), resolved.rule);
    return {
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
}

async function collectNestedConfigPaths(rootFolderPath: string, currentConfigPath: string): Promise<string[]> {
    if (!await fileExists(rootFolderPath)) {
        return [];
    }

    const nestedPaths: string[] = [];

    async function walk(directory: string): Promise<void> {
        const entries = await fs.readdir(directory, { withFileTypes: true });

        for (const entry of entries) {
            const candidatePath = path.join(directory, entry.name);
            if (isBlacklistedPath(candidatePath)) {
                continue;
            }

            if (entry.isDirectory()) {
                await walk(candidatePath);
                continue;
            }

            if (entry.isFile() && entry.name === ".rautomod" && path.normalize(candidatePath) !== path.normalize(currentConfigPath)) {
                nestedPaths.push(path.normalize(candidatePath));
            }
        }
    }

    await walk(rootFolderPath);
    return nestedPaths;
}

async function collectRustFilesUnder(rootFolderPath: string): Promise<string[]> {
    if (!await fileExists(rootFolderPath)) {
        return [];
    }

    const rustFiles: string[] = [];

    async function walk(directory: string): Promise<void> {
        const entries = await fs.readdir(directory, { withFileTypes: true });

        for (const entry of entries) {
            const candidatePath = path.join(directory, entry.name);
            if (isBlacklistedPath(candidatePath)) {
                continue;
            }

            if (entry.isDirectory()) {
                await walk(candidatePath);
                continue;
            }

            if (!entry.isFile() || !entry.name.endsWith(".rs")) {
                continue;
            }

            if (isSpecialRustFile(path.basename(entry.name, ".rs"))) {
                continue;
            }

            rustFiles.push(path.normalize(candidatePath));
        }
    }

    await walk(rootFolderPath);
    return rustFiles.sort();
}

async function collectWorkspaceModuleTree(
    workspaceFolder: vscode.WorkspaceFolder
): Promise<RautomodWorkspaceModuleTree> {
    if (!await fileExists(workspaceFolder.uri.fsPath)) {
        return createEmptyWorkspaceModuleTree(workspaceFolder);
    }

    const crateRoots = await collectCrateRootFiles(workspaceFolder.uri.fsPath);
    const roots = await Promise.all(crateRoots.map(crateRoot =>
        buildModuleTreeFromRegistrationFile(
            crateRoot,
            workspaceFolder.uri.fsPath,
            {
                id: crateRoot,
                name: path.basename(crateRoot, ".rs"),
                relativePath: normalizePath(path.relative(workspaceFolder.uri.fsPath, crateRoot)),
                declarationFilePath: crateRoot,
                declarationFileUri: vscode.Uri.file(crateRoot).toString(),
                kind: "crate" as const,
                layout: "crate_root" as const,
                visibility: undefined,
                sourceFilePath: crateRoot,
                sourceFileUri: vscode.Uri.file(crateRoot).toString(),
                childContainerPath: path.dirname(crateRoot),
                canCreateChild: true,
                movableToCrateRoot: false
            }
        )
    ));

    return {
        workspaceName: workspaceFolder.name,
        workspaceUri: workspaceFolder.uri.toString(),
        roots
    };
}

function createEmptyWorkspaceModuleTree(
    workspaceFolder: vscode.WorkspaceFolder
): RautomodWorkspaceModuleTree {
    return {
        workspaceName: workspaceFolder.name,
        workspaceUri: workspaceFolder.uri.toString(),
        roots: []
    };
}

interface TreeBuildContext {
    id: string;
    name: string;
    relativePath: string;
    declarationFilePath: string;
    declarationFileUri: string;
    kind: "crate" | "module";
    layout: RautomodModuleTreeNode["layout"];
    visibility?: string;
    sourceFilePath?: string;
    sourceFileUri?: string;
    childContainerPath?: string;
    canCreateChild: boolean;
    movableToCrateRoot: boolean;
}

async function buildModuleTreeFromRegistrationFile(
    registrationFilePath: string,
    workspaceRootPath: string,
    context: TreeBuildContext
): Promise<RautomodModuleTreeNode> {
    const content = await readFileIfExists(registrationFilePath) ?? "";
    const declarations = parseManagedDeclarations(content.split(/\r?\n/))
        .filter(declaration => declaration.kind === "mod");

    const children = await Promise.all(declarations.map(async declaration => {
        const childSource = await resolveChildModuleSourcePath(registrationFilePath, declaration.moduleName);
        const relativePath = normalizePath(path.relative(workspaceRootPath, childSource?.filePath ?? path.join(await resolveSourceDirectoryForRegistrationFile(registrationFilePath), `${declaration.moduleName}.rs`)));
        const nextContext: TreeBuildContext = {
            id: childSource?.filePath ?? `${registrationFilePath}:${declaration.moduleName}`,
            name: declaration.moduleName,
            relativePath,
            declarationFilePath: registrationFilePath,
            declarationFileUri: vscode.Uri.file(registrationFilePath).toString(),
            kind: "module",
            layout: childSource?.layout ?? "missing",
            visibility: declaration.visibility,
            sourceFilePath: childSource?.filePath,
            sourceFileUri: childSource?.filePath ? vscode.Uri.file(childSource.filePath).toString() : undefined,
            childContainerPath: childSource?.childContainerPath,
            canCreateChild: Boolean(childSource?.childContainerPath),
            movableToCrateRoot: Boolean(childSource?.filePath && childSource.layout === "leaf")
        };

        if (childSource?.registrationFilePath) {
            return buildModuleTreeFromRegistrationFile(childSource.registrationFilePath, workspaceRootPath, nextContext);
        }

        return {
            id: nextContext.id,
            name: nextContext.name,
            relativePath: nextContext.relativePath,
            sourceFileUri: nextContext.sourceFileUri,
            sourceFilePath: nextContext.sourceFilePath,
            declarationFileUri: nextContext.declarationFileUri,
            visibility: nextContext.visibility,
            kind: nextContext.kind,
            layout: nextContext.layout,
            canCreateChild: nextContext.canCreateChild,
            movableToCrateRoot: nextContext.movableToCrateRoot,
            childContainerUri: nextContext.childContainerPath ? vscode.Uri.file(nextContext.childContainerPath).toString() : undefined,
            children: []
        } satisfies RautomodModuleTreeNode;
    }));

    return {
        id: context.id,
        name: context.name,
        relativePath: context.relativePath,
        sourceFileUri: context.sourceFileUri,
        sourceFilePath: context.sourceFilePath,
        declarationFileUri: context.declarationFileUri,
        visibility: context.visibility,
        kind: context.kind,
        layout: context.layout,
        canCreateChild: context.canCreateChild,
        movableToCrateRoot: context.movableToCrateRoot,
        childContainerUri: context.childContainerPath ? vscode.Uri.file(context.childContainerPath).toString() : undefined,
        children
    };
}

async function resolveChildModuleSourcePath(
    registrationFilePath: string,
    moduleName: string
): Promise<{
    filePath?: string;
    registrationFilePath?: string;
    layout: RautomodModuleTreeNode["layout"];
    childContainerPath?: string;
} | null> {
    const sourceDirectory = await resolveSourceDirectoryForRegistrationFile(registrationFilePath);
    const leafFilePath = path.join(sourceDirectory, `${moduleName}.rs`);
    const classicFilePath = path.join(sourceDirectory, moduleName, "mod.rs");

    if (await fileExists(leafFilePath)) {
        const isPair = await isModulePairRegistrationFile(leafFilePath);
        return {
            filePath: leafFilePath,
            registrationFilePath: isPair ? leafFilePath : undefined,
            layout: isPair ? "modern" : "leaf",
            childContainerPath: isPair ? path.join(sourceDirectory, moduleName) : undefined
        };
    }

    if (await fileExists(classicFilePath)) {
        return {
            filePath: classicFilePath,
            registrationFilePath: classicFilePath,
            layout: "classic",
            childContainerPath: path.dirname(classicFilePath)
        };
    }

    return {
        layout: "missing"
    };
}

async function collectCrateRootFiles(workspaceRootPath: string): Promise<string[]> {
    if (!await fileExists(workspaceRootPath)) {
        return [];
    }

    const crateRoots: string[] = [];

    async function walk(directory: string): Promise<void> {
        const entries = await fs.readdir(directory, { withFileTypes: true });

        for (const entry of entries) {
            const candidatePath = path.join(directory, entry.name);
            if (isBlacklistedPath(candidatePath)) {
                continue;
            }

            if (entry.isDirectory()) {
                await walk(candidatePath);
                continue;
            }

            if (!entry.isFile()) {
                continue;
            }

            if (entry.name === "lib.rs" || entry.name === "main.rs") {
                crateRoots.push(path.normalize(candidatePath));
            }
        }
    }

    await walk(workspaceRootPath);
    return crateRoots.sort();
}

async function readFileIfExists(filePath: string): Promise<string | null> {
    try {
        return await fs.readFile(filePath, "utf8");
    } catch {
        return null;
    }
}

function isMissingPathError(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && (error as { code?: string }).code === "ENOENT";
}

async function resolveTargetFilePathForRule(folderPath: string, rule: AutomodRule): Promise<string | null> {
    const targetPath = await resolveModuleRegistrationFileForTarget(folderPath, rule.target ?? "auto");
    if (targetPath) {
        return targetPath;
    }

    if ((rule.target ?? "auto") === "auto" || rule.target === "mod.rs") {
        return path.join(folderPath, "mod.rs");
    }

    return null;
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
