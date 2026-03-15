import * as vscode from "vscode";

type WorkspaceStateMap<T> = Record<string, T>;

export class WorkspaceStateService<T extends object> {
    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly storageKey: string,
        private readonly normalize: (value: Partial<T> | undefined) => T
    ) { }

    get(workspaceFolder: vscode.WorkspaceFolder): T {
        const stateMap = this.context.workspaceState.get<WorkspaceStateMap<T>>(this.storageKey, {});
        return this.normalize(stateMap[this.getWorkspaceKey(workspaceFolder)]);
    }

    async set(workspaceFolder: vscode.WorkspaceFolder, value: T): Promise<void> {
        const stateMap = this.context.workspaceState.get<WorkspaceStateMap<T>>(this.storageKey, {});
        stateMap[this.getWorkspaceKey(workspaceFolder)] = this.normalize(value);
        await this.context.workspaceState.update(this.storageKey, stateMap);
    }

    async update(workspaceFolder: vscode.WorkspaceFolder, updater: (value: T) => T): Promise<T> {
        const nextValue = updater(this.get(workspaceFolder));
        await this.set(workspaceFolder, nextValue);
        return nextValue;
    }

    private getWorkspaceKey(workspaceFolder: vscode.WorkspaceFolder): string {
        return workspaceFolder.uri.toString();
    }
}
