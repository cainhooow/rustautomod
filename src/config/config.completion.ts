import * as vscode from "vscode";

export const completionProvider = vscode.languages.registerCompletionItemProvider(
    { pattern: "**/.rautomod" },
    {
        provideCompletionItems(document, pos) {
            const linePrefix = document.lineAt(pos).text.substring(0, pos.character);

            const completions: vscode.CompletionItem[] = [];

            if ("visibility".startsWith(linePrefix.trim())) {
                const item = new vscode.CompletionItem("visibility", vscode.CompletionItemKind.Keyword);
                item.detail = "Set module visibility (pub/private)";
                completions.push(item);
            }
            if ("sort".startsWith(linePrefix.trim())) {
                const item = new vscode.CompletionItem("sort", vscode.CompletionItemKind.Keyword);
                item.detail = "Set sorting order for mod.rs (alpha/none)";
                completions.push(item);
            }

            if (/^visibility\s*=/.test(linePrefix)) {
                completions.push(new vscode.CompletionItem("pub", vscode.CompletionItemKind.Value));
                completions.push(new vscode.CompletionItem("private", vscode.CompletionItemKind.Value));
            }

            if (/^sort\s*=/.test(linePrefix)) {
                completions.push(new vscode.CompletionItem("alpha", vscode.CompletionItemKind.Value));
                completions.push(new vscode.CompletionItem("none", vscode.CompletionItemKind.Value));
            }

            return completions;
        }
    },
);