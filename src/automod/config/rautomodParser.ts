import {
    AutomodConfigDiagnostic,
    AutomodConfigDocument,
    AutomodRule,
    AutomodStrictMode
} from "../../interfaces/automodconf";
import { smartSplitCfg } from "../cfgUtils";
import {
    createDefaultRule,
    createDiagnostic,
    DEFAULT_GROUP_ORDER,
    isOneOf,
    normalizeRule,
    splitSimpleList,
    VALID_FMT,
    VALID_GROUP_ORDER,
    VALID_SORT,
    VALID_STRICT_MODE,
    VALID_TARGET,
    VALID_VISIBILITY
} from "./rautomodShared";

export function parseRautomod(content: string): AutomodRule[] {
    return parseRautomodDocument(content).rules;
}

export function createDefaultAutomodRule(sourcePath?: string): AutomodRule {
    return createDefaultRule(sourcePath);
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
                currentRule.groupOrder = splitSimpleList(rawValue).filter(Boolean) as typeof DEFAULT_GROUP_ORDER;
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
