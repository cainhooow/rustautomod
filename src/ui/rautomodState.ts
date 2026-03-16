import * as path from "path";
import * as vscode from "vscode";
import {
    AutomodConfigDiagnostic,
    AutomodConfigDocument,
    AutomodRule
} from "../interfaces/automodconf";
import {
    parseRautomodDocument,
    serializeRautomodDocument
} from "../automod/automodConfigFile";
import { smartSplitCfg } from "../automod/cfgUtils";

export interface RautomodRuleViewModel {
    id: string;
    visibility: string;
    sort: string;
    fmt: string;
    target: string;
    pattern: string;
    exclude: string;
    cfg: string;
    groupOrder: string;
    blankLines: number;
    reexport: string;
    header: string;
    generatedComment: string;
}

export interface RautomodDocumentViewModel {
    uri: string;
    fileName: string;
    workspaceName?: string;
    rawText: string;
    schemaVersion: string;
    strictMode: string;
    extendsPaths: string;
    rules: RautomodRuleViewModel[];
    diagnostics: AutomodConfigDiagnostic[];
}

export interface RautomodConfigSummary {
    uri: string;
    fileName: string;
    workspaceName?: string;
    relativePath: string;
    ruleCount: number;
    diagnosticCount: number;
    strictMode: string;
    schemaVersion: string;
    extendsCount: number;
}

export interface RautomodManagerState {
    configs: RautomodConfigSummary[];
    workspaceFolders: Array<{ name: string, uri: string }>;
}

export function createRautomodDocumentViewModel(
    document: vscode.TextDocument
): RautomodDocumentViewModel {
    const rawText = document.getText();
    const parsed = parseRautomodDocument(rawText, document.uri.fsPath);
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);

    return {
        uri: document.uri.toString(),
        fileName: document.fileName,
        workspaceName: workspaceFolder?.name,
        rawText,
        schemaVersion: parsed.schemaVersion,
        strictMode: parsed.strictMode,
        extendsPaths: parsed.extendsPaths.join(","),
        rules: parsed.rules.map((rule, index) => toRuleViewModel(rule, index)),
        diagnostics: parsed.diagnostics
    };
}

export function serializeViewModelToRawText(viewModel: RautomodDocumentViewModel): string {
    const document: AutomodConfigDocument = {
        sourcePath: toFsPath(viewModel.uri) ?? viewModel.fileName,
        schemaVersion: viewModel.schemaVersion || "1",
        strictMode: normalizeStrictMode(viewModel.strictMode),
        extendsPaths: splitCommaList(viewModel.extendsPaths),
        diagnostics: [],
        rules: viewModel.rules.map(toAutomodRule)
    };

    return serializeRautomodDocument(document);
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
        const document = await vscode.workspace.openTextDocument(uri);
        const parsed = parseRautomodDocument(document.getText(), uri.fsPath);
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);

        return {
            uri: uri.toString(),
            fileName: path.basename(uri.fsPath),
            workspaceName: workspaceFolder?.name,
            relativePath: workspaceFolder
                ? normalizePath(path.relative(workspaceFolder.uri.fsPath, uri.fsPath))
                : uri.fsPath,
            ruleCount: parsed.rules.length,
            diagnosticCount: parsed.diagnostics.length,
            strictMode: parsed.strictMode,
            schemaVersion: parsed.schemaVersion,
            extendsCount: parsed.extendsPaths.length
        } satisfies RautomodConfigSummary;
    }));

    configs.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

    return {
        configs,
        workspaceFolders
    };
}

function toRuleViewModel(rule: AutomodRule, index: number): RautomodRuleViewModel {
    return {
        id: `rule-${index}-${Math.random().toString(36).slice(2, 8)}`,
        visibility: rule.visibility,
        sort: rule.sort,
        fmt: rule.fmt ?? "disabled",
        target: rule.target ?? "auto",
        pattern: (rule.pattern ?? []).join(","),
        exclude: (rule.exclude ?? []).join(","),
        cfg: (rule.cfg ?? []).join(","),
        groupOrder: (rule.groupOrder ?? []).join(","),
        blankLines: rule.blankLines ?? 1,
        reexport: rule.reexport ?? "disabled",
        header: rule.header ?? "",
        generatedComment: rule.generatedComment ?? ""
    };
}

function toAutomodRule(rule: RautomodRuleViewModel): AutomodRule {
    return {
        visibility: normalizeVisibility(rule.visibility),
        sort: normalizeSort(rule.sort),
        fmt: rule.fmt === "enabled" ? "enabled" : "disabled",
        target: normalizeTarget(rule.target),
        pattern: splitCommaList(rule.pattern),
        exclude: splitCommaList(rule.exclude),
        cfg: smartSplitCfg(rule.cfg),
        groupOrder: splitCommaList(rule.groupOrder) as AutomodRule["groupOrder"],
        blankLines: Math.max(0, Number(rule.blankLines) || 0),
        reexport: rule.reexport === "enabled" ? "enabled" : "disabled",
        header: rule.header.trim() || undefined,
        generatedComment: rule.generatedComment.trim() || undefined
    };
}

function splitCommaList(value: string): string[] {
    return value
        .split(",")
        .map(entry => entry.trim())
        .filter(Boolean);
}

function normalizeVisibility(value: string): AutomodRule["visibility"] {
    switch (value) {
        case "private":
        case "pub(crate)":
        case "pub(super)":
            return value;
        case "pub":
        default:
            return "pub";
    }
}

function normalizeSort(value: string): AutomodRule["sort"] {
    switch (value) {
        case "alpha_case_insensitive":
        case "none":
        case "pub_first":
        case "cfg_first":
            return value;
        case "alpha":
        default:
            return "alpha";
    }
}

function normalizeTarget(value: string): AutomodRule["target"] {
    switch (value) {
        case "mod.rs":
        case "lib.rs":
        case "main.rs":
            return value;
        case "auto":
        default:
            return "auto";
    }
}

function normalizeStrictMode(value: string): AutomodConfigDocument["strictMode"] {
    switch (value) {
        case "off":
        case "error":
            return value;
        case "warn":
        default:
            return "warn";
    }
}

function toFsPath(uriAsString: string): string | null {
    try {
        return vscode.Uri.parse(uriAsString).fsPath;
    } catch {
        return null;
    }
}

function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, "/");
}
