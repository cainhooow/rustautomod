export type AutomodVisibility = "pub" | "private" | "pub(crate)" | "pub(super)";
export type AutomodSortMode = "alpha" | "alpha_case_insensitive" | "none" | "pub_first" | "cfg_first";
export type AutomodFmtMode = "enabled" | "disabled";
export type AutomodTarget = "auto" | "mod.rs" | "lib.rs" | "main.rs";
export type AutomodReexportMode = "enabled" | "disabled";
export type AutomodStrictMode = "off" | "warn" | "error";
export type AutomodGroupOrder = "cfg" | "pub_mod" | "mod" | "pub_use" | "use";
export type AutomodDiagnosticSeverity = "warning" | "error";

export interface AutomodRule {
    visibility: AutomodVisibility;
    sort: AutomodSortMode;
    pattern?: string[];
    exclude?: string[];
    cfg?: string[];
    fmt?: AutomodFmtMode;
    target?: AutomodTarget;
    groupOrder?: AutomodGroupOrder[];
    blankLines?: number;
    reexport?: AutomodReexportMode;
    header?: string;
    generatedComment?: string;
    sourcePath?: string;
}

export interface AutomodConfigDiagnostic {
    line: number;
    message: string;
    code: string;
    severity: AutomodDiagnosticSeverity;
    key?: string;
    value?: string;
    suggestions?: string[];
}

export interface AutomodConfigDocument {
    sourcePath?: string;
    schemaVersion: string;
    strictMode: AutomodStrictMode;
    extendsPaths: string[];
    rules: AutomodRule[];
    diagnostics: AutomodConfigDiagnostic[];
}

export interface ResolvedAutomodConfig {
    rule: AutomodRule;
    sourcePath?: string;
    matchedRuleIndex: number;
    matchedPatterns: string[];
    schemaVersion: string;
    strictMode: AutomodStrictMode;
    diagnostics: AutomodConfigDiagnostic[];
    ignored: boolean;
}
