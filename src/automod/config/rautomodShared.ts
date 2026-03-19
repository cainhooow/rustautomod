import vscode from "vscode";
import {
    AutomodConfigDiagnostic,
    AutomodFmtMode,
    AutomodGroupOrder,
    AutomodRule,
    AutomodSortMode,
    AutomodStrictMode,
    AutomodTarget,
    AutomodVisibility,
    ResolvedAutomodConfig
} from "../../interfaces/automodconf";

export const VALID_VISIBILITY: readonly AutomodVisibility[] = ["pub", "private", "pub(crate)", "pub(super)"];
export const VALID_SORT: readonly AutomodSortMode[] = ["alpha", "alpha_case_insensitive", "none", "pub_first", "cfg_first"];
export const VALID_FMT: readonly AutomodFmtMode[] = ["enabled", "disabled"];
export const VALID_TARGET: readonly AutomodTarget[] = ["auto", "mod.rs", "lib.rs", "main.rs"];
export const VALID_GROUP_ORDER: readonly AutomodGroupOrder[] = ["cfg", "pub_mod", "mod", "pub_use", "use"];
export const VALID_STRICT_MODE: readonly AutomodStrictMode[] = ["off", "warn", "error"];
export const DEFAULT_GROUP_ORDER: AutomodGroupOrder[] = ["use", "cfg", "pub_mod", "mod", "pub_use"];
export const DOCUMENT_KEYS = new Set(["schema_version", "strict", "extends"]);
export const RULE_KEYS = new Set([
    "visibility",
    "sort",
    "fmt",
    "target",
    "pattern",
    "exclude",
    "cfg",
    "group_order",
    "blank_lines",
    "reexport",
    "header",
    "generated_comment"
]);

export interface AutomodRuleEvaluation {
    matched: boolean;
    ignored: boolean;
    matchedPatterns: string[];
    excludedPatterns: string[];
    negativePatterns: string[];
    positivePatterns: string[];
    relativePath: string;
    sourceDir: string;
    reason: "matched_default" | "matched_pattern" | "excluded_by_negative_pattern" | "no_positive_pattern_match";
}

export function createDefaultResolvedConfig(configuration: vscode.WorkspaceConfiguration): ResolvedAutomodConfig {
    return {
        rule: getDefaultConfig(configuration),
        sourcePath: undefined,
        matchedRuleIndex: -1,
        matchedPatterns: [],
        schemaVersion: "1",
        strictMode: "warn",
        diagnostics: [],
        ignored: false
    };
}

export function createDefaultRule(sourcePath?: string): AutomodRule {
    return normalizeRule({
        visibility: "pub",
        sort: "alpha",
        fmt: "disabled",
        target: "auto",
        groupOrder: DEFAULT_GROUP_ORDER,
        blankLines: 1,
        reexport: "disabled",
        sourcePath
    });
}

export function normalizeRule(rule: AutomodRule): AutomodRule {
    return {
        visibility: rule.visibility,
        sort: rule.sort,
        fmt: rule.fmt ?? "disabled",
        target: rule.target ?? "auto",
        groupOrder: normalizeGroupOrder(rule.groupOrder),
        blankLines: Math.max(0, rule.blankLines ?? 1),
        reexport: rule.reexport ?? "disabled",
        pattern: rule.pattern?.filter(Boolean),
        exclude: rule.exclude?.filter(Boolean),
        cfg: rule.cfg?.filter(Boolean),
        header: rule.header?.trim() ? rule.header.trim() : undefined,
        generatedComment: rule.generatedComment?.trim() ? rule.generatedComment.trim() : undefined,
        sourcePath: rule.sourcePath
    };
}

export function normalizeGroupOrder(groupOrder: AutomodGroupOrder[] | undefined): AutomodGroupOrder[] {
    const order = groupOrder?.filter(value => isOneOf(value, VALID_GROUP_ORDER)) ?? DEFAULT_GROUP_ORDER;
    const unique = Array.from(new Set(order));

    for (const group of VALID_GROUP_ORDER) {
        if (!unique.includes(group)) {
            unique.push(group);
        }
    }

    return unique;
}

export function getDefaultConfig(configuration: vscode.WorkspaceConfiguration): AutomodRule {
    const visibility = configuration.get<AutomodVisibility>("visibility", "pub");
    const sort = configuration.get<AutomodSortMode>("sort", "alpha");
    const fmt = configuration.get<AutomodFmtMode>("fmt", "disabled");

    return normalizeRule({
        visibility: isOneOf(visibility, VALID_VISIBILITY) ? visibility : "pub",
        sort: isOneOf(sort, VALID_SORT) ? sort : "alpha",
        fmt: isOneOf(fmt, VALID_FMT) ? fmt : "disabled",
        target: "auto",
        groupOrder: DEFAULT_GROUP_ORDER,
        blankLines: 1,
        reexport: "disabled"
    });
}

export function splitSimpleList(value: string): string[] {
    return value.split(",").map(entry => entry.trim()).filter(Boolean);
}

export function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, "/");
}

export function createDiagnostic(
    line: number,
    code: string,
    message: string,
    severity: AutomodConfigDiagnostic["severity"],
    key?: string,
    value?: string,
    suggestions?: string[]
): AutomodConfigDiagnostic {
    return {
        line,
        code,
        message,
        severity,
        key,
        value,
        suggestions
    };
}

export function isOneOf<T extends string>(value: string, allowedValues: readonly T[]): value is T {
    return allowedValues.includes(value as T);
}
