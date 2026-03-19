import * as vscode from "vscode";
import { formatRautomod } from "../linting/rautomodFormatter";
import {
    createRautomodDocumentViewModel,
    serializeViewModelToRawText,
    RautomodDocumentViewModel
} from "./rautomodState";
import { collectRautomodEditorInsights } from "./rautomodStudioService";
import { invalidateRautomodStudioCaches } from "./studio/rautomodStudioCacheService";
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
        let lastPostedVersion = -1;
        let insightsTimer: NodeJS.Timeout | undefined;
        let insightsRequestId = 0;

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri]
        };

        const scheduleInsightsSync = (
            rawText: string,
            matchPath?: string,
            delay = 120
        ): void => {
            if (!isWebviewReady || isDisposed) {
                return;
            }

            if (insightsTimer) {
                clearTimeout(insightsTimer);
            }

            const requestId = ++insightsRequestId;
            insightsTimer = setTimeout(() => {
                insightsTimer = undefined;
                void (async () => {
                    try {
                        const value = await collectRautomodEditorInsights(document.uri, rawText, matchPath);
                        if (isDisposed || !isWebviewReady || requestId !== insightsRequestId) {
                            return;
                        }

                        await webviewPanel.webview.postMessage({
                            type: "setInsights",
                            value
                        });
                    } catch (error) {
                        if (!isDisposed) {
                            console.warn("RUST AUTOMOD STUDIO: Failed to update editor insights.", error);
                        }
                    }
                })();
            }, delay);
        };

        const updateWebview = async (force = false): Promise<void> => {
            if (!isWebviewReady || isDisposed) {
                return;
            }

            try {
                if (force || lastPostedVersion !== document.version) {
                    lastPostedVersion = document.version;
                    await webviewPanel.webview.postMessage({
                        type: "setState",
                        value: createRautomodDocumentViewModel(document)
                    });
                }

                scheduleInsightsSync(document.getText(), undefined, force ? 0 : 120);
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
            if (insightsTimer) {
                clearTimeout(insightsTimer);
                insightsTimer = undefined;
            }
            changeDocumentSubscription.dispose();
        });

        webviewPanel.webview.onDidReceiveMessage(async message => {
            switch (message.type) {
                case "ready":
                    isWebviewReady = true;
                    await updateWebview(true);
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
                    scheduleInsightsSync(
                        String(message.rawText ?? document.getText()),
                        typeof message.matchPath === "string" ? message.matchPath : undefined,
                        0
                    );
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
        await updateWebview(true);
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
    invalidateRautomodStudioCaches();
}
