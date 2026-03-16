import * as vscode from "vscode";
import { openAutomodLog, regenerateModules, scaffoldRautomod } from "../automod/automodModFile";
import { formatRautomod } from "../linting/rautomodFormatter";
import {
    collectManagerPlaygroundResult,
    collectRautomodManagerState
} from "./rautomodStudioService";
import { openRautomodRaw, openRautomodVisual } from "./rautomodCustomEditor";
import { getRautomodManagerHtml } from "./rautomodWebviewTemplates";

export class RautomodManagerViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    static readonly viewId = "rustautomod.managerView";

    private webviewView: vscode.WebviewView | undefined;
    private readonly watcher = vscode.workspace.createFileSystemWatcher("**/.rautomod");
    private isViewReady = false;
    private isDisposed = false;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.watcher.onDidCreate(() => {
            void this.refresh();
        });
        this.watcher.onDidChange(() => {
            void this.refresh();
        });
        this.watcher.onDidDelete(() => {
            void this.refresh();
        });
    }

    async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
        this.webviewView = webviewView;
        this.isViewReady = false;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri]
        };

        webviewView.webview.onDidReceiveMessage(async message => {
            await handleManagerMessage(
                this.context,
                message,
                () => {
                    this.isViewReady = true;
                },
                () => this.refresh(),
                async payload => {
                    await webviewView.webview.postMessage(payload);
                }
            );
        });

        webviewView.webview.html = getRautomodManagerHtml(webviewView.webview, this.context.extensionUri);
        await this.refresh();
    }

    async refresh(): Promise<void> {
        if (!this.webviewView || !this.isViewReady || this.isDisposed) {
            return;
        }

        try {
            await postManagerState(this.webviewView.webview);
        } catch (error) {
            if (!this.isDisposed) {
                console.warn("RUST AUTOMOD STUDIO: Failed to refresh manager view.", error);
            }
        }
    }

    dispose(): void {
        this.isDisposed = true;
        this.watcher.dispose();
    }
}

export function registerRautomodManagerView(
    context: vscode.ExtensionContext
): vscode.Disposable {
    const provider = new RautomodManagerViewProvider(context);
    const registration = vscode.window.registerWebviewViewProvider(
        RautomodManagerViewProvider.viewId,
        provider,
        {
            webviewOptions: {
                retainContextWhenHidden: true
            }
        }
    );

    const workspaceListener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void provider.refresh();
    });

    return vscode.Disposable.from(provider, registration, workspaceListener);
}

export class RautomodManagerPanel implements vscode.Disposable {
    static readonly viewType = "rustautomod.managerPanel";

    private static currentPanel: RautomodManagerPanel | undefined;

    private readonly watcher = vscode.workspace.createFileSystemWatcher("**/.rautomod");
    private readonly workspaceListener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void this.refresh();
    });
    private isPanelReady = false;
    private isDisposed = false;

    private constructor(
        private readonly panel: vscode.WebviewPanel,
        private readonly context: vscode.ExtensionContext
    ) {
        this.panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri]
        };

        this.panel.onDidDispose(() => {
            this.dispose();
        });

        this.panel.webview.onDidReceiveMessage(async message => {
            await handleManagerMessage(
                this.context,
                message,
                () => {
                    this.isPanelReady = true;
                },
                () => this.refresh(),
                async payload => {
                    await this.panel.webview.postMessage(payload);
                }
            );
        });

        this.watcher.onDidCreate(() => {
            void this.refresh();
        });
        this.watcher.onDidChange(() => {
            void this.refresh();
        });
        this.watcher.onDidDelete(() => {
            void this.refresh();
        });

        this.panel.webview.html = getRautomodManagerHtml(this.panel.webview, this.context.extensionUri);
        void this.refresh();
    }

    static createOrShow(context: vscode.ExtensionContext): void {
        if (RautomodManagerPanel.currentPanel) {
            RautomodManagerPanel.currentPanel.panel.reveal(vscode.ViewColumn.Active);
            void RautomodManagerPanel.currentPanel.refresh();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            RautomodManagerPanel.viewType,
            "Rust AutoMod Manager",
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [context.extensionUri]
            }
        );

        RautomodManagerPanel.currentPanel = new RautomodManagerPanel(panel, context);
    }

    async refresh(): Promise<void> {
        if (!this.isPanelReady || this.isDisposed) {
            return;
        }

        try {
            await postManagerState(this.panel.webview);
        } catch (error) {
            if (!this.isDisposed) {
                console.warn("RUST AUTOMOD STUDIO: Failed to refresh manager panel.", error);
            }
        }
    }

    dispose(): void {
        if (RautomodManagerPanel.currentPanel === this) {
            RautomodManagerPanel.currentPanel = undefined;
        }

        this.isDisposed = true;
        this.watcher.dispose();
        this.workspaceListener.dispose();
    }
}

export function openRautomodManager(context: vscode.ExtensionContext): void {
    RautomodManagerPanel.createOrShow(context);
}

async function postManagerState(webview: vscode.Webview): Promise<void> {
    await webview.postMessage({
        type: "setState",
        value: await collectRautomodManagerState()
    });
}

async function handleManagerMessage(
    context: vscode.ExtensionContext,
    message: unknown,
    markReady: () => void,
    refresh: () => Promise<void>,
    postMessage: (payload: unknown) => Promise<void>
): Promise<void> {
    const payload = message as {
        type?: string;
        uri?: string;
        inputPath?: string;
        workspaceUri?: string;
        message?: string;
        context?: string;
    };

    switch (payload.type) {
        case "ready":
            markReady();
            await refresh();
            return;
        case "refresh":
            await refresh();
            return;
        case "openVisual":
            await openRautomodVisual(vscode.Uri.parse(String(payload.uri)));
            return;
        case "openRaw":
            await openRautomodRaw(vscode.Uri.parse(String(payload.uri)));
            return;
        case "openFile":
            if (payload.uri) {
                await vscode.window.showTextDocument(vscode.Uri.parse(String(payload.uri)));
            }
            return;
        case "revealFolder":
            if (payload.uri) {
                await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.parse(String(payload.uri)));
            }
            return;
        case "runPlayground":
            if (!payload.uri || !payload.inputPath) {
                return;
            }
            await postMessage({
                type: "setPlaygroundResult",
                uri: payload.uri,
                value: await collectManagerPlaygroundResult(vscode.Uri.parse(String(payload.uri)), payload.inputPath)
            });
            return;
        case "scaffold":
            await scaffoldRautomod(vscode.Uri.parse(String(payload.uri)));
            await refresh();
            return;
        case "scaffoldAll":
            await scaffoldAllWorkspaceRoots();
            await refresh();
            return;
        case "formatAll":
            await formatAllRautomodFiles();
            await refresh();
            return;
        case "regenerateWorkspace":
            await regenerateModules(payload.workspaceUri ? vscode.Uri.parse(payload.workspaceUri) : undefined);
            await refresh();
            return;
        case "openDiagnosticConfigs":
            await openConfigsWithDiagnostics();
            return;
        case "openLog":
            openAutomodLog();
            return;
        case "openManagerPanel":
            openRautomodManager(context);
            return;
        case "logWebviewError":
            console.error("RUST AUTOMOD STUDIO MANAGER ERROR:", payload.context, payload.message);
            return;
    }
}

async function scaffoldAllWorkspaceRoots(): Promise<void> {
    for (const workspaceFolder of vscode.workspace.workspaceFolders ?? []) {
        await scaffoldRautomod(workspaceFolder.uri);
    }
}

async function formatAllRautomodFiles(): Promise<void> {
    const uris = await vscode.workspace.findFiles(
        "**/.rautomod",
        "**/{node_modules,target,.git,out,dist,build}/**"
    );

    for (const uri of uris) {
        const document = await vscode.workspace.openTextDocument(uri);
        const nextText = formatRautomod(document.getText());
        if (nextText === document.getText()) {
            continue;
        }

        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length)
        );
        edit.replace(uri, fullRange, nextText);
        await vscode.workspace.applyEdit(edit);
        await document.save();
    }
}

async function openConfigsWithDiagnostics(): Promise<void> {
    const state = await collectRautomodManagerState();
    const diagnosticConfigs = state.configs.filter(config => config.diagnosticCount > 0);

    for (const config of diagnosticConfigs) {
        await openRautomodRaw(vscode.Uri.parse(config.uri));
    }
}
