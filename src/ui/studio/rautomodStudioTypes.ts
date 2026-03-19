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
