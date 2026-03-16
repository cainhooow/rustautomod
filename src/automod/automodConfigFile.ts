import vscode from "vscode";
import path from "path";
import fs from "fs";
import { promises as fsPromises } from "fs";
import {
    AutomodConfigDiagnostic,
    AutomodConfigDocument,
    AutomodFmtMode,
    AutomodGroupOrder,
    AutomodRule,
    AutomodSortMode,
    AutomodStrictMode,
    AutomodTarget,
    AutomodVisibility,
    ResolvedAutomodConfig
} from "../interfaces/automodconf";
import { smartSplitCfg } from "./cfgUtils";

const VALID_VISIBILITY: readonly AutomodVisibility[] = ["pub", "private", "pub(crate)", "pub(super)"];
const VALID_SORT: readonly AutomodSortMode[] = ["alpha", "alpha_case_insensitive", "none", "pub_first", "cfg_first"];
const VALID_FMT: readonly AutomodFmtMode[] = ["enabled", "disabled"];
const VALID_TARGET: readonly AutomodTarget[] = ["auto", "mod.rs", "lib.rs", "main.rs"];
const VALID_GROUP_ORDER: readonly AutomodGroupOrder[] = ["cfg", "pub_mod", "mod", "pub_use", "use"];
const VALID_STRICT_MODE: readonly AutomodStrictMode[] = ["off", "warn", "error"];
const DEFAULT_GROUP_ORDER: AutomodGroupOrder[] = ["use", "cfg", "pub_mod", "mod", "pub_use"];

export function parseRautomod(content: string): AutomodRule[] {
    return parseRautomodDocument(content).rules;
}

export function parseRautomodDocument(content: string, sourcePath?: string): AutomodConfigDocument {
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    const diagnostics: AutomodConfigDiagnostic[] = [];
    const rules: AutomodRule[] = [];
    const extendsPaths: string[] = [];
    let schemaVersion = "1";
    let strictMode: AutomodStrictMode = "warn";

    let currentRule = createDefaultRule(sourcePath);
    let hasRuleContent = false;

    const flushRule = () => {
        if (!hasRuleContent) {
            currentRule = createDefaultRule(sourcePath);
            return;
        }

        rules.push(normalizeRule(currentRule));
        currentRule = createDefaultRule(sourcePath);
        hasRuleContent = false;
    };

    for (let index = 0; index < lines.length; index++) {
        const trimmed = lines[index].trim();
        if (trimmed === "") {
            flushRule();
            continue;
        }

        if (trimmed.startsWith("#")) {
            continue;
        }

        const separatorIndex = trimmed.indexOf("=");
        if (separatorIndex === -1) {
            diagnostics.push(createDiagnostic(index, "invalid_line", "invalid line in .rautomod", "error"));
            continue;
        }

        const key = trimmed.substring(0, separatorIndex).trim();
        const rawValue = trimmed.substring(separatorIndex + 1).trim();

        switch (key) {
            case "extends":
                extendsPaths.push(...splitSimpleList(rawValue));
                break;
            case "schema_version":
                if (rawValue === "1") {
                    schemaVersion = rawValue;
                } else {
                    diagnostics.push(createDiagnostic(index, "invalid_schema_version", "schema_version accepts only '1'", "error", key, rawValue, ["1"]));
                }
                break;
            case "strict":
                if (isOneOf(rawValue, VALID_STRICT_MODE)) {
                    strictMode = rawValue;
                } else {
                    diagnostics.push(createDiagnostic(index, "invalid_strict", "strict accepts only 'off', 'warn', or 'error'", "error", key, rawValue, [...VALID_STRICT_MODE]));
                }
                break;
            case "visibility":
                hasRuleContent = true;
                if (isOneOf(rawValue, VALID_VISIBILITY)) {
                    currentRule.visibility = rawValue;
                } else {
                    diagnostics.push(createDiagnostic(index, "invalid_visibility", "visibility accepts only 'pub', 'private', 'pub(crate)', or 'pub(super)'", "error", key, rawValue, [...VALID_VISIBILITY]));
                }
                break;
            case "sort":
                hasRuleContent = true;
                if (isOneOf(rawValue, VALID_SORT)) {
                    currentRule.sort = rawValue;
                } else {
                    diagnostics.push(createDiagnostic(index, "invalid_sort", "sort accepts only 'alpha', 'alpha_case_insensitive', 'none', 'pub_first', or 'cfg_first'", "error", key, rawValue, [...VALID_SORT]));
                }
                break;
            case "fmt":
                hasRuleContent = true;
                if (isOneOf(rawValue, VALID_FMT)) {
                    currentRule.fmt = rawValue;
                } else {
                    diagnostics.push(createDiagnostic(index, "invalid_fmt", "fmt accepts only 'enabled' or 'disabled'", "error", key, rawValue, [...VALID_FMT]));
                }
                break;
            case "target":
                hasRuleContent = true;
                if (isOneOf(rawValue, VALID_TARGET)) {
                    currentRule.target = rawValue;
                } else {
                    diagnostics.push(createDiagnostic(index, "invalid_target", "target accepts only 'auto', 'mod.rs', 'lib.rs', or 'main.rs'", "error", key, rawValue, [...VALID_TARGET]));
                }
                break;
            case "pattern":
                hasRuleContent = true;
                currentRule.pattern = splitSimpleList(rawValue);
                if (currentRule.pattern.some(value => value === "")) {
                    diagnostics.push(createDiagnostic(index, "invalid_pattern", "pattern values cannot be empty", "error", key, rawValue));
                }
                break;
            case "exclude":
                hasRuleContent = true;
                currentRule.exclude = splitSimpleList(rawValue);
                if (currentRule.exclude.some(value => value === "")) {
                    diagnostics.push(createDiagnostic(index, "invalid_exclude", "exclude values cannot be empty", "error", key, rawValue));
                }
                break;
            case "cfg":
                hasRuleContent = true;
                currentRule.cfg = smartSplitCfg(rawValue);
                if (currentRule.cfg.some(value => value === "")) {
                    diagnostics.push(createDiagnostic(index, "invalid_cfg", "cfg values cannot be empty", "error", key, rawValue));
                }
                break;
            case "group_order":
                hasRuleContent = true;
                currentRule.groupOrder = splitSimpleList(rawValue).filter(Boolean) as AutomodGroupOrder[];
                if (currentRule.groupOrder.some(value => !isOneOf(value, VALID_GROUP_ORDER))) {
                    diagnostics.push(createDiagnostic(index, "invalid_group_order", "group_order accepts only 'cfg', 'pub_mod', 'mod', 'pub_use', and 'use'", "error", key, rawValue, [...VALID_GROUP_ORDER]));
                    currentRule.groupOrder = DEFAULT_GROUP_ORDER;
                }
                break;
            case "blank_lines":
                hasRuleContent = true;
                if (/^\d+$/.test(rawValue)) {
                    currentRule.blankLines = Number(rawValue);
                } else {
                    diagnostics.push(createDiagnostic(index, "invalid_blank_lines", "blank_lines accepts only non-negative integers", "error", key, rawValue, ["0", "1", "2"]));
                }
                break;
            case "reexport":
                hasRuleContent = true;
                if (rawValue === "enabled" || rawValue === "disabled") {
                    currentRule.reexport = rawValue;
                } else {
                    diagnostics.push(createDiagnostic(index, "invalid_reexport", "reexport accepts only 'enabled' or 'disabled'", "error", key, rawValue, ["enabled", "disabled"]));
                }
                break;
            case "header":
                hasRuleContent = true;
                currentRule.header = rawValue;
                break;
            case "generated_comment":
                hasRuleContent = true;
                currentRule.generatedComment = rawValue;
                break;
            default:
                diagnostics.push(createDiagnostic(index, "unknown_key", `unknown key '${key}' in .rautomod`, "warning", key, rawValue));
                break;
        }
    }

    flushRule();

    return {
        sourcePath,
        schemaVersion,
        strictMode,
        extendsPaths: Array.from(new Set(extendsPaths)),
        rules,
        diagnostics
    };
}

export function findConfigForFile(rules: AutomodRule[], filePath: string): AutomodRule | null {
    for (const rule of rules) {
        const evaluation = evaluateRule(rule, filePath);
        if (evaluation.matched) {
            return rule;
        }
    }

    return null;
}

export function resolveProjectConfig(filePath: string): ResolvedAutomodConfig {
    for (const configPath of getCandidateConfigPaths(filePath)) {
        if (!fs.existsSync(configPath)) {
            continue;
        }

        const document = loadConfigDocumentSync(configPath, new Set<string>());
        const resolved = resolveFromDocument(document, filePath);
        if (resolved) {
            return resolved;
        }
    }

    return createDefaultResolvedConfig(vscode.workspace.getConfiguration("rustautomod"));
}

export function getProjectConfig(filePath: string): AutomodRule {
    return resolveProjectConfig(filePath).rule;
}

export async function resolveProjectConfigAsync(filePath: string): Promise<ResolvedAutomodConfig> {
    for (const configPath of getCandidateConfigPaths(filePath)) {
        if (!await fileExists(configPath)) {
            continue;
        }

        const document = await loadConfigDocumentAsync(configPath, new Set<string>());
        const resolved = resolveFromDocument(document, filePath);
        if (resolved) {
            return resolved;
        }
    }

    return createDefaultResolvedConfig(vscode.workspace.getConfiguration("rustautomod"));
}

export async function getProjectConfigAsync(filePath: string): Promise<AutomodRule> {
    const resolved = await resolveProjectConfigAsync(filePath);
    return resolved.rule;
}

function createDefaultResolvedConfig(configuration: vscode.WorkspaceConfiguration): ResolvedAutomodConfig {
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

function createDefaultRule(sourcePath?: string): AutomodRule {
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

function normalizeRule(rule: AutomodRule): AutomodRule {
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

function normalizeGroupOrder(groupOrder: AutomodGroupOrder[] | undefined): AutomodGroupOrder[] {
    const order = groupOrder?.filter(value => isOneOf(value, VALID_GROUP_ORDER)) ?? DEFAULT_GROUP_ORDER;
    const unique = Array.from(new Set(order));

    for (const group of VALID_GROUP_ORDER) {
        if (!unique.includes(group)) {
            unique.push(group);
        }
    }

    return unique;
}

function resolveFromDocument(document: AutomodConfigDocument, filePath: string): ResolvedAutomodConfig | null {
    for (let index = 0; index < document.rules.length; index++) {
        const rule = document.rules[index];
        const evaluation = evaluateRule(rule, filePath);
        if (!evaluation.matched) {
            continue;
        }

        return {
            rule,
            sourcePath: document.sourcePath,
            matchedRuleIndex: index,
            matchedPatterns: evaluation.matchedPatterns,
            schemaVersion: document.schemaVersion,
            strictMode: document.strictMode,
            diagnostics: document.diagnostics,
            ignored: evaluation.ignored
        };
    }

    return null;
}

function evaluateRule(rule: AutomodRule, filePath: string): { matched: boolean, ignored: boolean, matchedPatterns: string[] } {
    const normalizedPath = normalizePath(filePath);
    const fileName = path.basename(normalizedPath);
    const sourceDir = rule.sourcePath ? path.dirname(rule.sourcePath) : path.dirname(normalizedPath);
    const relativePath = normalizePath(path.relative(sourceDir, filePath));
    const candidates = [normalizedPath, relativePath, fileName];

    const excludes = (rule.exclude ?? []).filter(pattern => patternMatchesFile(pattern, candidates));
    const patterns = rule.pattern ?? [];
    const negativePatterns = patterns.filter(pattern => pattern.startsWith("!")).map(pattern => pattern.slice(1).trim());
    const positivePatterns = patterns.filter(pattern => !pattern.startsWith("!"));

    if (negativePatterns.some(pattern => patternMatchesFile(pattern, candidates))) {
        return { matched: false, ignored: false, matchedPatterns: [] };
    }

    if (positivePatterns.length > 0) {
        const matchedPatterns = positivePatterns.filter(pattern => patternMatchesFile(pattern, candidates));
        if (matchedPatterns.length === 0) {
            return { matched: false, ignored: false, matchedPatterns: [] };
        }

        return {
            matched: true,
            ignored: excludes.length > 0,
            matchedPatterns
        };
    }

    return {
        matched: true,
        ignored: excludes.length > 0,
        matchedPatterns: []
    };
}

function patternMatchesFile(pattern: string, candidates: string[]): boolean {
    const normalizedPattern = normalizePath(pattern).replace(/^\.\//, "");
    if (normalizedPattern === "") {
        return false;
    }

    const regex = globToRegex(normalizedPattern);

    return candidates.some(candidate => {
        const normalizedCandidate = normalizePath(candidate);
        return regex.test(normalizedCandidate)
            || normalizedCandidate.includes(normalizedPattern)
            || path.basename(normalizedCandidate) === normalizedPattern;
    });
}

function globToRegex(pattern: string): RegExp {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const regexBody = escaped
        .replace(/\*\*/g, ".*")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, ".");

    return new RegExp(`(^|/)${regexBody}$`);
}

function getCandidateConfigPaths(filePath: string): string[] {
    const candidates: string[] = [];
    let currentDir = path.dirname(filePath);

    while (currentDir !== path.dirname(currentDir)) {
        candidates.push(path.join(currentDir, ".rautomod"));
        currentDir = path.dirname(currentDir);
    }

    return candidates;
}

function loadConfigDocumentSync(configPath: string, visited: Set<string>): AutomodConfigDocument {
    const normalizedPath = path.normalize(configPath);
    if (visited.has(normalizedPath)) {
        return {
            sourcePath: configPath,
            schemaVersion: "1",
            strictMode: "warn",
            extendsPaths: [],
            rules: [],
            diagnostics: [
                createDiagnostic(0, "circular_extends", "circular extends detected in .rautomod", "error", "extends")
            ]
        };
    }

    visited.add(normalizedPath);
    const content = fs.readFileSync(configPath, "utf-8");
    const current = parseRautomodDocument(content, configPath);
    return mergeExtendedDocuments(current, current.extendsPaths.map(extendsPath => {
        const resolvedPath = resolveExtendedConfigPath(configPath, extendsPath);
        if (!resolvedPath || !fs.existsSync(resolvedPath)) {
            return createMissingExtendsDocument(configPath, extendsPath);
        }

        return loadConfigDocumentSync(resolvedPath, visited);
    }));
}

async function loadConfigDocumentAsync(configPath: string, visited: Set<string>): Promise<AutomodConfigDocument> {
    const normalizedPath = path.normalize(configPath);
    if (visited.has(normalizedPath)) {
        return {
            sourcePath: configPath,
            schemaVersion: "1",
            strictMode: "warn",
            extendsPaths: [],
            rules: [],
            diagnostics: [
                createDiagnostic(0, "circular_extends", "circular extends detected in .rautomod", "error", "extends")
            ]
        };
    }

    visited.add(normalizedPath);
    const content = await fsPromises.readFile(configPath, "utf-8");
    const current = parseRautomodDocument(content, configPath);
    const extendedDocuments = await Promise.all(current.extendsPaths.map(async extendsPath => {
        const resolvedPath = resolveExtendedConfigPath(configPath, extendsPath);
        if (!resolvedPath || !await fileExists(resolvedPath)) {
            return createMissingExtendsDocument(configPath, extendsPath);
        }

        return loadConfigDocumentAsync(resolvedPath, visited);
    }));

    return mergeExtendedDocuments(current, extendedDocuments);
}

function mergeExtendedDocuments(current: AutomodConfigDocument, extendedDocuments: AutomodConfigDocument[]): AutomodConfigDocument {
    let merged = current;

    for (const extended of extendedDocuments) {
        merged = {
            sourcePath: current.sourcePath,
            schemaVersion: current.schemaVersion || extended.schemaVersion,
            strictMode: current.strictMode || extended.strictMode,
            extendsPaths: Array.from(new Set([...current.extendsPaths, ...extended.extendsPaths])),
            rules: [...current.rules, ...extended.rules],
            diagnostics: [...current.diagnostics, ...extended.diagnostics]
        };
    }

    return merged;
}

function createMissingExtendsDocument(configPath: string, extendsPath: string): AutomodConfigDocument {
    return {
        sourcePath: configPath,
        schemaVersion: "1",
        strictMode: "warn",
        extendsPaths: [],
        rules: [],
        diagnostics: [
            createDiagnostic(0, "missing_extends", `extends target '${extendsPath}' could not be resolved`, "error", "extends", extendsPath)
        ]
    };
}

function resolveExtendedConfigPath(configPath: string, extendsPath: string): string | null {
    if (!extendsPath.trim()) {
        return null;
    }

    if (path.isAbsolute(extendsPath)) {
        return extendsPath;
    }

    return path.resolve(path.dirname(configPath), extendsPath);
}

function getDefaultConfig(configuration: vscode.WorkspaceConfiguration): AutomodRule {
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

function splitSimpleList(value: string): string[] {
    return value.split(",").map(entry => entry.trim()).filter(Boolean);
}

function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, "/");
}

function createDiagnostic(
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

function isOneOf<T extends string>(value: string, allowedValues: readonly T[]): value is T {
    return allowedValues.includes(value as T);
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fsPromises.access(filePath);
        return true;
    } catch {
        return false;
    }
}
