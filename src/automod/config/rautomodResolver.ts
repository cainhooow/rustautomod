import vscode from "vscode";
import path from "path";
import fs from "fs";
import { promises as fsPromises } from "fs";
import {
    AutomodConfigDocument,
    AutomodRule,
    ResolvedAutomodConfig
} from "../../interfaces/automodconf";
import { parseRautomodDocument } from "./rautomodParser";
import {
    AutomodRuleEvaluation,
    createDefaultResolvedConfig,
    createDiagnostic,
    normalizePath
} from "./rautomodShared";

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

export async function resolveRautomodDocumentAsync(
    content: string,
    sourcePath?: string
): Promise<AutomodConfigDocument> {
    const current = parseRautomodDocument(content, sourcePath);
    if (!sourcePath) {
        return current;
    }

    const extendedDocuments = await Promise.all(current.extendsPaths.map(async extendsPath => {
        const resolvedPath = resolveExtendedConfigPath(sourcePath, extendsPath);
        if (!resolvedPath || !await fileExists(resolvedPath)) {
            return createMissingExtendsDocument(sourcePath, extendsPath);
        }

        return loadConfigDocumentAsync(resolvedPath, new Set<string>([path.normalize(sourcePath)]));
    }));

    return mergeExtendedDocuments(current, extendedDocuments);
}

export function resolveConfigForFileFromDocument(
    document: AutomodConfigDocument,
    filePath: string
): ResolvedAutomodConfig | null {
    return resolveFromDocument(document, filePath);
}

export function evaluateAutomodRule(rule: AutomodRule, filePath: string): AutomodRuleEvaluation {
    return evaluateRule(rule, filePath);
}

function resolveFromDocument(document: AutomodConfigDocument, filePath: string): ResolvedAutomodConfig | null {
    for (let index = 0; index < document.rules.length; index += 1) {
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

function evaluateRule(rule: AutomodRule, filePath: string): AutomodRuleEvaluation {
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
        return {
            matched: false,
            ignored: false,
            matchedPatterns: [],
            excludedPatterns: excludes,
            negativePatterns,
            positivePatterns,
            relativePath,
            sourceDir,
            reason: "excluded_by_negative_pattern"
        };
    }

    if (positivePatterns.length > 0) {
        const matchedPatterns = positivePatterns.filter(pattern => patternMatchesFile(pattern, candidates));
        if (matchedPatterns.length === 0) {
            return {
                matched: false,
                ignored: false,
                matchedPatterns: [],
                excludedPatterns: excludes,
                negativePatterns,
                positivePatterns,
                relativePath,
                sourceDir,
                reason: "no_positive_pattern_match"
            };
        }

        return {
            matched: true,
            ignored: excludes.length > 0,
            matchedPatterns,
            excludedPatterns: excludes,
            negativePatterns,
            positivePatterns,
            relativePath,
            sourceDir,
            reason: "matched_pattern"
        };
    }

    return {
        matched: true,
        ignored: excludes.length > 0,
        matchedPatterns: [],
        excludedPatterns: excludes,
        negativePatterns,
        positivePatterns,
        relativePath,
        sourceDir,
        reason: "matched_default"
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
        return createCircularExtendsDocument(configPath);
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
        return createCircularExtendsDocument(configPath);
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

function createCircularExtendsDocument(configPath: string): AutomodConfigDocument {
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

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fsPromises.access(filePath);
        return true;
    } catch {
        return false;
    }
}
