import * as vscode from "vscode";

const RAUTOMOD_DOCUMENT_SELECTOR: vscode.DocumentSelector = [{ language: "rautomod" }, { pattern: "**/.rautomod" }];

export const rautomodCodeActions = vscode.languages.registerCodeActionsProvider(
    RAUTOMOD_DOCUMENT_SELECTOR,
    {
        provideCodeActions(document, _range, context) {
            const actions: vscode.CodeAction[] = [];

            for (const diagnostic of context.diagnostics) {
                const action = createFixAction(document, diagnostic);
                if (action) {
                    actions.push(action);
                }
            }

            const insertMissingKeysAction = createInsertMissingKeysAction(document);
            if (insertMissingKeysAction) {
                actions.push(insertMissingKeysAction);
            }

            return actions;
        }
    },
    {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
    }
);

function createFixAction(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction | null {
    const line = document.lineAt(diagnostic.range.start.line);
    const key = line.text.split("=")[0].trim();
    const replacement = getReplacementForDiagnostic(String(diagnostic.code), key);
    if (replacement === null) {
        return null;
    }

    const action = new vscode.CodeAction(`Fix ${key}`, vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];
    action.edit = new vscode.WorkspaceEdit();
    action.edit.replace(document.uri, line.range, replacement);
    return action;
}

function createInsertMissingKeysAction(document: vscode.TextDocument): vscode.CodeAction | null {
    const text = document.getText();
    const existingKeys = new Set(
        text.split(/\r?\n/)
            .map(line => line.split("=")[0].trim())
            .filter(Boolean)
    );

    const missingKeys = ["visibility", "sort", "fmt", "target"].filter(key => !existingKeys.has(key));
    if (missingKeys.length === 0) {
        return null;
    }

    const lines = missingKeys.map(key => `${key}=${getDefaultValueForKey(key)}`);
    const prefix = text.trim() === "" ? "" : "\n";
    const action = new vscode.CodeAction("Insert common Rust AutoMod keys", vscode.CodeActionKind.QuickFix);
    action.edit = new vscode.WorkspaceEdit();
    action.edit.insert(document.uri, new vscode.Position(document.lineCount, 0), `${prefix}${lines.join("\n")}\n`);
    return action;
}

function getReplacementForDiagnostic(code: string, key: string): string | null {
    switch (code) {
        case "invalid_visibility":
            return "visibility=pub";
        case "invalid_sort":
            return "sort=alpha";
        case "invalid_fmt":
            return "fmt=disabled";
        case "invalid_target":
            return "target=auto";
        case "invalid_group_order":
            return "group_order=use,cfg,pub_mod,mod,pub_use";
        case "invalid_blank_lines":
            return "blank_lines=1";
        case "invalid_reexport":
            return "reexport=disabled";
        case "invalid_strict":
            return "strict=warn";
        case "invalid_schema_version":
            return "schema_version=1";
        case "unknown_key":
            return `# removed invalid key: ${key}`;
        default:
            return null;
    }
}

function getDefaultValueForKey(key: string): string {
    switch (key) {
        case "visibility":
            return "pub";
        case "sort":
            return "alpha";
        case "fmt":
            return "disabled";
        case "target":
            return "auto";
        default:
            return "";
    }
}
