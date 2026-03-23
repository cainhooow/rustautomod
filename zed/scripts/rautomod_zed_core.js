"use strict";

const fs = require("fs");
const path = require("path");

const VALID_VISIBILITY = new Set(["pub", "private", "pub(crate)", "pub(super)"]);
const VALID_SORT = new Set(["alpha", "alpha_case_insensitive", "none", "pub_first", "cfg_first"]);
const VALID_FMT = new Set(["enabled", "disabled"]);
const VALID_TARGET = new Set(["auto", "mod.rs", "lib.rs", "main.rs"]);
const VALID_GROUP_ORDER = new Set(["cfg", "pub_mod", "mod", "pub_use", "use"]);
const VALID_STRICT_MODE = new Set(["off", "warn", "error"]);
const VALID_REEXPORT = new Set(["enabled", "disabled"]);
const DEFAULT_GROUP_ORDER = ["use", "cfg", "pub_mod", "mod", "pub_use"];

const RAUTOMOD_KEY_DETAILS = {
    schema_version: "Defines the supported .rautomod schema version. Current value: 1.",
    strict: "Controls validation strictness for this config: off, warn, or error.",
    extends: "Imports rules from another .rautomod file relative to the current config.",
    visibility: "Controls generated module visibility: pub, private, pub(crate), or pub(super).",
    sort: "Controls how generated declarations are sorted or grouped.",
    fmt: "Controls whether cargo fmt should run after Rust AutoMod writes files.",
    target: "Selects where generated declarations are written: auto, mod.rs, lib.rs, or main.rs.",
    pattern: "Matches files or folders this rule should apply to. Supports negation with !pattern.",
    exclude: "Marks matching files or folders as ignored by Rust AutoMod.",
    cfg: "Applies cfg(...) attributes to generated declarations for this rule.",
    group_order: "Controls declaration group ordering such as use, cfg, pub_mod, mod, and pub_use.",
    blank_lines: "Controls how many blank lines appear between generated declaration groups.",
    reexport: "Controls whether matching modules should also generate pub use re-exports.",
    header: "Adds a managed header line ahead of generated declarations.",
    generated_comment: "Writes a custom managed comment into generated declaration blocks."
};

function starterConfig() {
    return [
        "# Rust AutoMod starter for Zed",
        "# This file stays compatible with the VS Code extension format.",
        "schema_version=1",
        "strict=warn",
        "",
        "visibility=pub",
        "sort=alpha",
        "fmt=disabled",
        "target=auto",
        "blank_lines=1",
        "reexport=disabled",
        ""
    ].join("\n");
}

function formatRautomod(content) {
    const normalized = String(content).replace(/\r\n/g, "\n");
    const rawLines = normalized.split("\n");
    const formattedLines = [];
    let previousWasBlank = false;

    for (const rawLine of rawLines) {
        const line = rawLine.trimEnd();
        const trimmed = line.trim();

        if (trimmed === "") {
            if (!previousWasBlank && formattedLines.length > 0) {
                formattedLines.push("");
            }
            previousWasBlank = true;
            continue;
        }

        previousWasBlank = false;
        if (trimmed.startsWith("#")) {
            formattedLines.push(trimmed);
            continue;
        }

        formattedLines.push(formatAssignmentLine(trimmed));
    }

    while (formattedLines.length > 0 && formattedLines[formattedLines.length - 1] === "") {
        formattedLines.pop();
    }

    return formattedLines.length > 0 ? `${formattedLines.join("\n")}\n` : "";
}

function formatAssignmentLine(line) {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
        return line;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();

    switch (key) {
        case "pattern":
        case "exclude":
        case "extends":
        case "group_order":
            return `${key}=${splitSimpleList(rawValue).join(",")}`;
        case "cfg":
            return `${key}=${smartSplitCfg(rawValue).join(",")}`;
        default:
            return `${key}=${rawValue}`;
    }
}

function parseRautomodDocument(content, sourcePath) {
    const lines = String(content).replace(/\r\n/g, "\n").split("\n");
    const diagnostics = [];
    const rules = [];
    const extendsPaths = [];
    let schemaVersion = "1";
    let strictMode = "warn";
    let currentRule = createDefaultRule(sourcePath);
    let hasRuleContent = false;

    function flushRule() {
        if (!hasRuleContent) {
            currentRule = createDefaultRule(sourcePath);
            return;
        }

        rules.push(normalizeRule(currentRule));
        currentRule = createDefaultRule(sourcePath);
        hasRuleContent = false;
    }

    for (let index = 0; index < lines.length; index += 1) {
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

        const key = trimmed.slice(0, separatorIndex).trim();
        const rawValue = trimmed.slice(separatorIndex + 1).trim();

        switch (key) {
            case "extends":
                extendsPaths.push(...splitSimpleList(rawValue));
                break;
            case "schema_version":
                if (rawValue === "1") {
                    schemaVersion = rawValue;
                } else {
                    diagnostics.push(createDiagnostic(index, "invalid_schema_version", "schema_version accepts only '1'", "error"));
                }
                break;
            case "strict":
                if (VALID_STRICT_MODE.has(rawValue)) {
                    strictMode = rawValue;
                } else {
                    diagnostics.push(createDiagnostic(index, "invalid_strict", "strict accepts only 'off', 'warn', or 'error'", "error"));
                }
                break;
            case "visibility":
                hasRuleContent = true;
                if (VALID_VISIBILITY.has(rawValue)) {
                    currentRule.visibility = rawValue;
                } else {
                    diagnostics.push(createDiagnostic(index, "invalid_visibility", "invalid visibility value", "error"));
                }
                break;
            case "sort":
                hasRuleContent = true;
                if (VALID_SORT.has(rawValue)) {
                    currentRule.sort = rawValue;
                } else {
                    diagnostics.push(createDiagnostic(index, "invalid_sort", "invalid sort value", "error"));
                }
                break;
            case "fmt":
                hasRuleContent = true;
                if (VALID_FMT.has(rawValue)) {
                    currentRule.fmt = rawValue;
                } else {
                    diagnostics.push(createDiagnostic(index, "invalid_fmt", "invalid fmt value", "error"));
                }
                break;
            case "target":
                hasRuleContent = true;
                if (VALID_TARGET.has(rawValue)) {
                    currentRule.target = rawValue;
                } else {
                    diagnostics.push(createDiagnostic(index, "invalid_target", "invalid target value", "error"));
                }
                break;
            case "pattern":
                hasRuleContent = true;
                currentRule.pattern = splitSimpleList(rawValue);
                break;
            case "exclude":
                hasRuleContent = true;
                currentRule.exclude = splitSimpleList(rawValue);
                break;
            case "cfg":
                hasRuleContent = true;
                currentRule.cfg = smartSplitCfg(rawValue);
                break;
            case "group_order":
                hasRuleContent = true;
                currentRule.groupOrder = splitSimpleList(rawValue).filter(value => VALID_GROUP_ORDER.has(value));
                if (currentRule.groupOrder.length === 0 && rawValue) {
                    diagnostics.push(createDiagnostic(index, "invalid_group_order", "group_order only accepts cfg, pub_mod, mod, pub_use, or use", "warning"));
                }
                break;
            case "blank_lines":
                hasRuleContent = true;
                if (/^\d+$/.test(rawValue)) {
                    currentRule.blankLines = Number(rawValue);
                } else {
                    diagnostics.push(createDiagnostic(index, "invalid_blank_lines", "blank_lines must be a non-negative integer", "error"));
                }
                break;
            case "reexport":
                hasRuleContent = true;
                if (VALID_REEXPORT.has(rawValue)) {
                    currentRule.reexport = rawValue;
                } else {
                    diagnostics.push(createDiagnostic(index, "invalid_reexport", "reexport accepts only 'enabled' or 'disabled'", "error"));
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
                diagnostics.push(createDiagnostic(index, "unknown_key", `unknown key '${key}' in .rautomod`, "warning"));
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

function resolveRautomodDocument(configPath, visited = new Set()) {
    const normalizedPath = path.normalize(configPath);
    if (visited.has(normalizedPath)) {
        return {
            sourcePath: configPath,
            schemaVersion: "1",
            strictMode: "warn",
            extendsPaths: [],
            rules: [],
            diagnostics: [createDiagnostic(0, "circular_extends", "circular extends detected", "error")]
        };
    }

    visited.add(normalizedPath);
    const current = parseRautomodDocument(fs.readFileSync(configPath, "utf8"), configPath);
    const inherited = current.extendsPaths.map(extendsPath => {
        const resolvedPath = path.resolve(path.dirname(configPath), extendsPath);
        if (!fs.existsSync(resolvedPath)) {
            return {
                sourcePath: resolvedPath,
                schemaVersion: "1",
                strictMode: "warn",
                extendsPaths: [],
                rules: [],
                diagnostics: [createDiagnostic(0, "missing_extends", `extends target not found: ${extendsPath}`, "error")]
            };
        }
        return resolveRautomodDocument(resolvedPath, visited);
    });

    return mergeDocuments(current, inherited);
}

function mergeDocuments(current, inherited) {
    return inherited.reduce((acc, next) => ({
        sourcePath: acc.sourcePath,
        schemaVersion: acc.schemaVersion || next.schemaVersion || "1",
        strictMode: acc.strictMode || next.strictMode || "warn",
        extendsPaths: Array.from(new Set([...(next.extendsPaths || []), ...(acc.extendsPaths || [])])),
        rules: [...(next.rules || []), ...(acc.rules || [])],
        diagnostics: [...(next.diagnostics || []), ...(acc.diagnostics || [])]
    }), {
        sourcePath: current.sourcePath,
        schemaVersion: current.schemaVersion,
        strictMode: current.strictMode,
        extendsPaths: current.extendsPaths.slice(),
        rules: current.rules.slice(),
        diagnostics: current.diagnostics.slice()
    });
}

function resolveProjectConfig(filePath) {
    for (const configPath of candidateConfigPaths(filePath)) {
        if (!fs.existsSync(configPath)) {
            continue;
        }
        const document = resolveRautomodDocument(configPath);
        const resolved = resolveFromDocument(document, filePath);
        if (resolved) {
            return resolved;
        }
    }
    return null;
}

function resolveFromDocument(document, filePath) {
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
            ignored: evaluation.ignored,
            reason: evaluation.reason
        };
    }

    return null;
}

function evaluateRule(rule, filePath) {
    const normalizedFilePath = normalizePath(filePath);
    const fileName = path.basename(normalizedFilePath);
    const sourceDir = rule.sourcePath ? path.dirname(rule.sourcePath) : path.dirname(normalizedFilePath);
    const relativePath = normalizePath(path.relative(sourceDir, filePath));
    const candidates = [normalizedFilePath, relativePath, fileName];

    const excludes = (rule.exclude || []).filter(pattern => patternMatchesFile(pattern, candidates));
    const patterns = rule.pattern || [];
    const negativePatterns = patterns.filter(pattern => pattern.startsWith("!")).map(pattern => pattern.slice(1).trim());
    const positivePatterns = patterns.filter(pattern => !pattern.startsWith("!"));

    if (negativePatterns.some(pattern => patternMatchesFile(pattern, candidates))) {
        return {
            matched: false,
            ignored: false,
            matchedPatterns: [],
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
                reason: "no_positive_pattern_match"
            };
        }

        return {
            matched: true,
            ignored: excludes.length > 0,
            matchedPatterns,
            reason: "matched_pattern"
        };
    }

    return {
        matched: true,
        ignored: excludes.length > 0,
        matchedPatterns: [],
        reason: "matched_default"
    };
}

function candidateConfigPaths(filePath) {
    const candidates = [];
    let currentDir = path.dirname(filePath);

    while (true) {
        candidates.push(path.join(currentDir, ".rautomod"));
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            break;
        }
        currentDir = parentDir;
    }

    return candidates;
}

function patternMatchesFile(pattern, candidates) {
    const normalizedPattern = normalizePath(String(pattern || "")).replace(/^\.\//, "");
    if (!normalizedPattern) {
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

function globToRegex(pattern) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const regexBody = escaped
        .replace(/\*\*/g, ".*")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, ".");
    return new RegExp(`(^|/)${regexBody}$`);
}

function createDefaultRule(sourcePath) {
    return normalizeRule({
        visibility: "pub",
        sort: "alpha",
        fmt: "disabled",
        target: "auto",
        groupOrder: DEFAULT_GROUP_ORDER.slice(),
        blankLines: 1,
        reexport: "disabled",
        sourcePath
    });
}

function normalizeRule(rule) {
    return {
        visibility: rule.visibility || "pub",
        sort: rule.sort || "alpha",
        fmt: rule.fmt || "disabled",
        target: rule.target || "auto",
        groupOrder: normalizeGroupOrder(rule.groupOrder),
        blankLines: Math.max(0, Number(rule.blankLines == null ? 1 : rule.blankLines)),
        reexport: rule.reexport || "disabled",
        pattern: (rule.pattern || []).filter(Boolean),
        exclude: (rule.exclude || []).filter(Boolean),
        cfg: (rule.cfg || []).filter(Boolean),
        header: rule.header ? String(rule.header).trim() : undefined,
        generatedComment: rule.generatedComment ? String(rule.generatedComment).trim() : undefined,
        sourcePath: rule.sourcePath
    };
}

function normalizeGroupOrder(groupOrder) {
    const order = (groupOrder || []).filter(value => VALID_GROUP_ORDER.has(value));
    const unique = Array.from(new Set(order.length > 0 ? order : DEFAULT_GROUP_ORDER));
    for (const group of VALID_GROUP_ORDER) {
        if (!unique.includes(group)) {
            unique.push(group);
        }
    }
    return unique;
}

function createDiagnostic(line, code, message, severity) {
    return { line, code, message, severity };
}

function splitSimpleList(value) {
    return String(value || "")
        .split(",")
        .map(entry => entry.trim())
        .filter(Boolean);
}

function smartSplitCfg(value) {
    const parts = [];
    let current = "";
    let depth = 0;

    for (const char of String(value || "")) {
        if (char === "(") {
            depth += 1;
        } else if (char === ")") {
            depth -= 1;
        }

        if (char === "," && depth === 0) {
            if (current.trim()) {
                parts.push(current.trim());
            }
            current = "";
            continue;
        }

        current += char;
    }

    if (current.trim()) {
        parts.push(current.trim());
    }

    return parts;
}

function normalizePath(filePath) {
    return String(filePath || "").replace(/\\/g, "/");
}

function resolveInsideWorktree(worktreeRoot, relativePath) {
    const resolved = path.resolve(worktreeRoot, relativePath || ".");
    const relative = path.relative(worktreeRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("Rust AutoMod Zed refuses to operate outside the current worktree.");
    }
    return resolved;
}

function toRelative(worktreeRoot, filePath) {
    return normalizePath(path.relative(worktreeRoot, filePath) || ".");
}

function requireArgument(args, message) {
    if (!args[0]) {
        throw new Error(message);
    }
    return args[0];
}

function normalizeVisibility(value) {
    const normalized = String(value || "pub").trim();
    if (!VALID_VISIBILITY.has(normalized)) {
        throw new Error("Visibility must be one of: pub, private, pub(crate), pub(super).");
    }
    return normalized;
}

function normalizeLayout(value) {
    const normalized = String(value || "auto").trim();
    if (!["auto", "classic", "modern"].includes(normalized)) {
        throw new Error("Layout must be one of: auto, classic, modern.");
    }
    return normalized;
}

function sanitizeModuleName(value) {
    const normalized = String(value || "").trim().replace(/\.rs$/, "");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
        throw new Error("Module names must be valid Rust identifiers.");
    }
    return normalized;
}

function detectLayout(targetDir) {
    const siblingModern = path.join(path.dirname(targetDir), `${path.basename(targetDir)}.rs`);
    if (fs.existsSync(siblingModern)) {
        return "modern";
    }
    if (fs.existsSync(path.join(targetDir, "mod.rs"))) {
        return "classic";
    }
    return "classic";
}

function resolveRegistrationTarget(targetDir, layout) {
    const libPath = path.join(targetDir, "lib.rs");
    const mainPath = path.join(targetDir, "main.rs");
    if (fs.existsSync(libPath)) {
        return libPath;
    }
    if (fs.existsSync(mainPath)) {
        return mainPath;
    }

    const targetName = path.basename(targetDir);
    const modernTarget = path.join(path.dirname(targetDir), `${targetName}.rs`);
    const classicTarget = path.join(targetDir, "mod.rs");

    if (fs.existsSync(modernTarget)) {
        return modernTarget;
    }
    if (fs.existsSync(classicTarget)) {
        return classicTarget;
    }

    return layout === "modern" ? modernTarget : classicTarget;
}

function ensureDirectoryForFile(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeIfMissing(filePath, content, createdPaths) {
    if (!fs.existsSync(filePath)) {
        ensureDirectoryForFile(filePath);
        fs.writeFileSync(filePath, content, "utf8");
        createdPaths.push(filePath);
    }
}

function declarationLine(moduleName, visibility) {
    if (visibility === "private") {
        return `mod ${moduleName};`;
    }
    return `${visibility} mod ${moduleName};`;
}

function appendDeclaration(content, declaration) {
    const trimmed = String(content || "").trimEnd();
    if (!trimmed) {
        return `${declaration}\n`;
    }
    return `${trimmed}\n${declaration}\n`;
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const shared = {
    fs,
    path,
    VALID_VISIBILITY,
    VALID_SORT,
    VALID_FMT,
    VALID_TARGET,
    VALID_GROUP_ORDER,
    VALID_STRICT_MODE,
    VALID_REEXPORT,
    DEFAULT_GROUP_ORDER,
    RAUTOMOD_KEY_DETAILS,
    starterConfig,
    formatRautomod,
    formatAssignmentLine,
    parseRautomodDocument,
    resolveRautomodDocument,
    mergeDocuments,
    resolveProjectConfig,
    resolveFromDocument,
    evaluateRule,
    candidateConfigPaths,
    patternMatchesFile,
    globToRegex,
    createDefaultRule,
    normalizeRule,
    normalizeGroupOrder,
    createDiagnostic,
    splitSimpleList,
    smartSplitCfg,
    normalizePath,
    resolveInsideWorktree,
    toRelative,
    requireArgument,
    normalizeVisibility,
    normalizeLayout,
    sanitizeModuleName,
    detectLayout,
    resolveRegistrationTarget,
    ensureDirectoryForFile,
    writeIfMissing,
    declarationLine,
    appendDeclaration,
    escapeRegExp
};

globalThis.__RUST_AUTOMOD_ZED_SHARED__ = shared;
module.exports = shared;
