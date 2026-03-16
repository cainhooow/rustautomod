import * as vscode from "vscode";
import { openAutomodLog, scaffoldRautomod } from "../automod/automodModFile";
import { collectRautomodManagerState } from "./rautomodState";
import { openRautomodRaw, openRautomodVisual } from "./rautomodCustomEditor";
import { getRautomodManagerHtml } from "./rautomodWebviewTemplates";

export class RautomodManagerViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    static readonly viewId = "rustautomod.managerView";

    private webviewView: vscode.WebviewView | undefined;
    private readonly watcher = vscode.workspace.createFileSystemWatcher("**/.rautomod");
    private isViewReady = false;

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
                () => this.refresh()
            );
        });

        webviewView.webview.html = getRautomodManagerHtml(webviewView.webview, this.context.extensionUri);
        await this.refresh();
    }

    async refresh(): Promise<void> {
        if (!this.webviewView) {
            return;
        }

        if (!this.isViewReady) {
            return;
        }

        await postManagerState(this.webviewView.webview);
    }

    dispose(): void {
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

    private constructor(
        private readonly panel: vscode.WebviewPanel,
        private readonly context: vscode.ExtensionContext
    ) {
        this.isPanelReady = false;
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
                () => this.refresh()
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
        if (!this.isPanelReady) {
            return;
        }

        await postManagerState(this.panel.webview);
    }

    dispose(): void {
        if (RautomodManagerPanel.currentPanel === this) {
            RautomodManagerPanel.currentPanel = undefined;
        }

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
    refresh: () => Promise<void>
): Promise<void> {
    const payload = message as { type?: string, uri?: string };

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
        case "scaffold":
            await scaffoldRautomod(vscode.Uri.parse(String(payload.uri)));
            await refresh();
            return;
        case "openLog":
            openAutomodLog();
            return;
        case "openManagerPanel":
            openRautomodManager(context);
            return;
    }
}
