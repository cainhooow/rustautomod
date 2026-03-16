import * as vscode from "vscode";
import { formatRautomod } from "../linting/rautomodFormatter";
import {
    createRautomodDocumentViewModel,
    serializeViewModelToRawText,
    RautomodDocumentViewModel
} from "./rautomodState";
import { collectRautomodEditorInsights } from "./rautomodStudioService";
import { getRautomodEditorHtml } from "./rautomodWebviewTemplates";

export class RautomodCustomEditorProvider implements vscode.CustomTextEditorProvider {
    static readonly viewType = "rustautomod.rautomodEditor";

    constructor(private readonly context: vscode.ExtensionContext) { }

    async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel
    ): Promise<void> {
        let isWebviewReady = false;
        let isDisposed = false;

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri]
        };

        const updateWebview = async (): Promise<void> => {
            if (!isWebviewReady || isDisposed) {
                return;
            }

            try {
                await webviewPanel.webview.postMessage({
                    type: "setState",
                    value: createRautomodDocumentViewModel(document)
                });

                await webviewPanel.webview.postMessage({
                    type: "setInsights",
                    value: await collectRautomodEditorInsights(document.uri, document.getText())
                });
            } catch (error) {
                if (!isDisposed) {
                    console.warn("RUST AUTOMOD STUDIO: Failed to update editor webview.", error);
                }
            }
        };

        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document.uri.toString() === document.uri.toString()) {
                void updateWebview();
            }
        });

        webviewPanel.onDidDispose(() => {
            isDisposed = true;
            changeDocumentSubscription.dispose();
        });

        webviewPanel.webview.onDidReceiveMessage(async message => {
            switch (message.type) {
                case "ready":
                    isWebviewReady = true;
                    await updateWebview();
                    return;
                case "applyVisual":
                    await this.applyVisualChanges(document, message.value as RautomodDocumentViewModel);
                    return;
                case "applyRaw":
                    await this.applyRawChanges(document, String(message.rawText ?? ""));
                    return;
                case "formatRaw":
                    await webviewPanel.webview.postMessage({
                        type: "formattedRaw",
                        rawText: formatRautomod(String(message.rawText ?? ""))
                    });
                    return;
                case "refreshInsights":
                    await webviewPanel.webview.postMessage({
                        type: "setInsights",
                        value: await collectRautomodEditorInsights(
                            document.uri,
                            String(message.rawText ?? document.getText()),
                            typeof message.matchPath === "string" ? message.matchPath : undefined
                        )
                    });
                    return;
                case "openRaw":
                    await openRautomodRaw(document.uri);
                    return;
                case "openFile":
                    if (message.uri) {
                        await vscode.window.showTextDocument(vscode.Uri.parse(String(message.uri)));
                    }
                    return;
                case "revealFolder":
                    if (message.uri) {
                        await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.parse(String(message.uri)));
                    }
                    return;
                case "logWebviewError":
                    console.error("RUST AUTOMOD STUDIO WEBVIEW ERROR:", message.context, message.message);
                    return;
            }
        });

        webviewPanel.webview.html = getRautomodEditorHtml(webviewPanel.webview, this.context.extensionUri);
        await updateWebview();
    }

    private async applyVisualChanges(
        document: vscode.TextDocument,
        viewModel: RautomodDocumentViewModel
    ): Promise<void> {
        const nextText = serializeViewModelToRawText(viewModel);
        await replaceDocumentContent(document, nextText);
    }

    private async applyRawChanges(document: vscode.TextDocument, rawText: string): Promise<void> {
        await replaceDocumentContent(document, rawText);
    }
}

export function registerRautomodCustomEditor(
    context: vscode.ExtensionContext
): vscode.Disposable {
    const provider = new RautomodCustomEditorProvider(context);
    return vscode.window.registerCustomEditorProvider(
        RautomodCustomEditorProvider.viewType,
        provider,
        {
            webviewOptions: {
                retainContextWhenHidden: true
            }
        }
    );
}

export async function openRautomodVisual(resource?: vscode.Uri): Promise<void> {
    const uri = resource ?? vscode.window.activeTextEditor?.document.uri;
    if (!uri) {
        return;
    }

    await vscode.commands.executeCommand(
        "vscode.openWith",
        uri,
        RautomodCustomEditorProvider.viewType
    );
}

export async function openRautomodRaw(resource?: vscode.Uri): Promise<void> {
    const uri = resource ?? vscode.window.activeTextEditor?.document.uri;
    if (!uri) {
        return;
    }

    await vscode.commands.executeCommand(
        "vscode.openWith",
        uri,
        "default"
    );
}

async function replaceDocumentContent(
    document: vscode.TextDocument,
    nextText: string
): Promise<void> {
    const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, fullRange, nextText);
    await vscode.workspace.applyEdit(edit);
    await document.save();
}
