import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { isValidRustPath } from "../utils/pathValidator";
import {
    isIndexLikeModRsContent,
    toRelativeExcludePattern,
    WorkspaceModVisibilityState
} from "./modVisibility";
import { ModVisibilityWorkspaceService } from "./modVisibilityWorkspaceService";

const REFRESH_DEBOUNCE_MS = 250;

interface HiddenModQuickPickItem extends vscode.QuickPickItem {
    workspaceFolder: vscode.WorkspaceFolder;
    pattern: string;
    filePath: string;
}

export class ModVisibilityController implements vscode.Disposable {
    private readonly refreshTimers = new Map<string, NodeJS.Timeout>();
    private refreshQueue: Promise<void> = Promise.resolve();
    private isApplyingExcludes = false;
    private readonly workspaceService: ModVisibilityWorkspaceService;

    constructor(context: vscode.ExtensionContext) {
        this.workspaceService = new ModVisibilityWorkspaceService(context);
    }

    async initialize(): Promise<void> {
        await this.refreshAllWorkspaceFolders();
    }

    dispose(): void {
        for (const timer of this.refreshTimers.values()) {
            clearTimeout(timer);
        }

        this.refreshTimers.clear();
    }

    async toggleAutoHideIndexModRs(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showInformationMessage("Open a Rust workspace to manage mod.rs visibility.");
            return;
        }

        const shouldEnable = !workspaceFolders.every(folder => this.getWorkspaceState(folder).autoHideIndexModRs);

        for (const folder of workspaceFolders) {
            await this.workspaceService.setAutoHide(folder, shouldEnable);
        }

        await this.enqueueRefresh(() => this.refreshAllWorkspaceFolders());

        vscode.window.showInformationMessage(
            shouldEnable
                ? "Smart mod.rs hiding enabled. Only index-like mod.rs files will be hidden."
                : "Smart mod.rs hiding disabled. Previously auto-hidden mod.rs files are visible again."
        );
    }

    async hideThisModRs(resource?: vscode.Uri): Promise<void> {
        const resolved = this.resolveModRsResource(resource);
        if (!resolved) {
            return;
        }

        const { workspaceFolder, filePath } = resolved;
        const pattern = toRelativeExcludePattern(workspaceFolder.uri.fsPath, filePath);
        const state = this.getWorkspaceState(workspaceFolder);

        if (state.manuallyHidden.includes(pattern)) {
            vscode.window.showInformationMessage("This mod.rs is already hidden manually.");
            return;
        }

        await this.workspaceService.setManuallyHidden(
            workspaceFolder,
            sortUnique([...state.manuallyHidden, pattern])
        );

        await this.enqueueRefresh(() => this.refreshWorkspaceFolder(workspaceFolder));
        vscode.window.showInformationMessage(`Hidden ${pattern}.`);
    }

    async restoreHiddenModRs(resource?: vscode.Uri): Promise<void> {
        const directTarget = this.resolveModRsResource(resource, true);

        if (directTarget) {
            const { workspaceFolder, filePath } = directTarget;
            const pattern = toRelativeExcludePattern(workspaceFolder.uri.fsPath, filePath);
            const state = this.getWorkspaceState(workspaceFolder);

            if (state.manuallyHidden.includes(pattern)) {
                await this.restoreManualHiddenPattern(workspaceFolder, pattern, filePath);
                return;
            }
        }

        const hiddenItems = await this.getManualHiddenQuickPickItems();
        if (hiddenItems.length === 0) {
            vscode.window.showInformationMessage("There are no manually hidden mod.rs files to restore.");
            return;
        }

        const selectedItem = await vscode.window.showQuickPick(hiddenItems, {
            placeHolder: "Select the mod.rs file you want to show again"
        });

        if (!selectedItem) {
            return;
        }

        await this.restoreManualHiddenPattern(selectedItem.workspaceFolder, selectedItem.pattern, selectedItem.filePath);
    }

    scheduleRefresh(uri: vscode.Uri, force = false): void {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (!workspaceFolder) {
            return;
        }

        const state = this.getWorkspaceState(workspaceFolder);
        if (!force && !state.autoHideIndexModRs) {
            return;
        }

        const workspaceKey = this.getWorkspaceKey(workspaceFolder);
        const currentTimer = this.refreshTimers.get(workspaceKey);
        if (currentTimer) {
            clearTimeout(currentTimer);
        }

        const timer = setTimeout(() => {
            this.refreshTimers.delete(workspaceKey);
            void this.enqueueRefresh(() => this.refreshWorkspaceFolder(workspaceFolder));
        }, REFRESH_DEBOUNCE_MS);

        this.refreshTimers.set(workspaceKey, timer);
    }

    handleConfigurationChange(event: vscode.ConfigurationChangeEvent): void {
        if (this.isApplyingExcludes || !event.affectsConfiguration("files.exclude")) {
            return;
        }

        void this.enqueueRefresh(() => this.refreshAllWorkspaceFolders());
    }

    private async refreshAllWorkspaceFolders(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders ?? [];

        for (const folder of workspaceFolders) {
            await this.refreshWorkspaceFolder(folder);
        }
    }

    private async refreshWorkspaceFolder(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
        const initialState = this.getWorkspaceState(workspaceFolder);
        const manuallyHidden = this.pruneHiddenPatterns(workspaceFolder, initialState.manuallyHidden);

        if (!arraysEqual(initialState.manuallyHidden, manuallyHidden)) {
            await this.workspaceService.setManuallyHidden(workspaceFolder, manuallyHidden);
        }

        const state = this.getWorkspaceState(workspaceFolder);
        const autoHidden = state.autoHideIndexModRs
            ? await this.collectIndexLikeModPatterns(workspaceFolder)
            : [];
        const desiredPatterns = sortUnique([...manuallyHidden, ...autoHidden]);

        this.isApplyingExcludes = true;
        try {
            await this.workspaceService.syncFilesExclude(workspaceFolder, desiredPatterns);
        } finally {
            this.isApplyingExcludes = false;
        }
    }

    private async restoreManualHiddenPattern(
        workspaceFolder: vscode.WorkspaceFolder,
        pattern: string,
        filePath: string
    ): Promise<void> {
        const state = this.getWorkspaceState(workspaceFolder);

        await this.workspaceService.setManuallyHidden(
            workspaceFolder,
            state.manuallyHidden.filter(entry => entry !== pattern)
        );

        await this.enqueueRefresh(() => this.refreshWorkspaceFolder(workspaceFolder));

        const stillAutoHidden = await this.isAutomaticallyHidden(workspaceFolder, filePath);
        vscode.window.showInformationMessage(
            stillAutoHidden
                ? "Manual hide removed, but this mod.rs is still hidden because smart hiding is enabled."
                : `Showing ${pattern} again.`
        );
    }

    private async getManualHiddenQuickPickItems(): Promise<HiddenModQuickPickItem[]> {
        const items: HiddenModQuickPickItem[] = [];
        const workspaceFolders = vscode.workspace.workspaceFolders ?? [];

        for (const workspaceFolder of workspaceFolders) {
            const state = this.getWorkspaceState(workspaceFolder);
            const manuallyHidden = this.pruneHiddenPatterns(workspaceFolder, state.manuallyHidden);

            if (!arraysEqual(state.manuallyHidden, manuallyHidden)) {
                await this.workspaceService.setManuallyHidden(workspaceFolder, manuallyHidden);
            }

            for (const pattern of manuallyHidden) {
                items.push({
                    label: pattern,
                    description: workspaceFolder.name,
                    workspaceFolder,
                    pattern,
                    filePath: path.join(workspaceFolder.uri.fsPath, pattern)
                });
            }
        }

        return items.sort((left, right) => left.label.localeCompare(right.label));
    }

    private async collectIndexLikeModPatterns(workspaceFolder: vscode.WorkspaceFolder): Promise<string[]> {
        const modFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolder, "**/mod.rs"),
            null
        );
        const patterns: string[] = [];

        for (const modFile of modFiles) {
            const filePath = modFile.fsPath;
            if (!isValidRustPath(filePath)) {
                continue;
            }

            const content = await readWorkspaceFile(modFile);
            if (content === null || !isIndexLikeModRsContent(content)) {
                continue;
            }

            patterns.push(toRelativeExcludePattern(workspaceFolder.uri.fsPath, filePath));
        }

        return sortUnique(patterns);
    }

    private async isAutomaticallyHidden(workspaceFolder: vscode.WorkspaceFolder, filePath: string): Promise<boolean> {
        const state = this.getWorkspaceState(workspaceFolder);
        if (!state.autoHideIndexModRs || !fs.existsSync(filePath)) {
            return false;
        }

        try {
            const content = await readWorkspaceFile(vscode.Uri.file(filePath));
            return content !== null && isIndexLikeModRsContent(content);
        } catch {
            return false;
        }
    }

    private pruneHiddenPatterns(workspaceFolder: vscode.WorkspaceFolder, patterns: string[]): string[] {
        const prunedPatterns = patterns.filter(pattern => {
            const filePath = path.join(workspaceFolder.uri.fsPath, pattern);
            return path.basename(filePath) === "mod.rs" && fs.existsSync(filePath);
        });

        return sortUnique(prunedPatterns);
    }

    private resolveModRsResource(
        resource?: vscode.Uri,
        silent = false
    ): { workspaceFolder: vscode.WorkspaceFolder; filePath: string } | null {
        const targetUri = resource ?? vscode.window.activeTextEditor?.document.uri;
        if (!targetUri || targetUri.scheme !== "file" || path.basename(targetUri.fsPath) !== "mod.rs") {
            if (!silent) {
                vscode.window.showInformationMessage("Select a mod.rs file to use this command.");
            }
            return null;
        }

        const workspaceFolder = vscode.workspace.getWorkspaceFolder(targetUri);
        if (!workspaceFolder) {
            if (!silent) {
                vscode.window.showInformationMessage("This mod.rs file is outside the current workspace.");
            }
            return null;
        }

        return {
            workspaceFolder,
            filePath: targetUri.fsPath
        };
    }

    private getWorkspaceState(workspaceFolder: vscode.WorkspaceFolder): WorkspaceModVisibilityState {
        return this.workspaceService.getState(workspaceFolder);
    }

    private getWorkspaceKey(workspaceFolder: vscode.WorkspaceFolder): string {
        return workspaceFolder.uri.toString();
    }

    private enqueueRefresh(task: () => Promise<void>): Promise<void> {
        this.refreshQueue = this.refreshQueue.then(task, task);
        return this.refreshQueue;
    }
}

async function readWorkspaceFile(uri: vscode.Uri): Promise<string | null> {
    try {
        const content = await vscode.workspace.fs.readFile(uri);
        return Buffer.from(content).toString("utf8");
    } catch {
        return null;
    }
}

function sortUnique(values: string[]): string[] {
    return Array.from(new Set(values)).sort();
}

function arraysEqual(left: string[], right: string[]): boolean {
    if (left.length !== right.length) {
        return false;
    }

    return left.every((value, index) => value === right[index]);
}
