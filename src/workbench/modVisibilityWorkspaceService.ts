import * as vscode from "vscode";
import { WorkspaceStateService } from "../workspace/workspaceStateService";
import {
    createDefaultWorkspaceModVisibilityState,
    FilesExcludeValue,
    reconcileManagedExcludes,
    WorkspaceModVisibilityState
} from "./modVisibility";

const WORKSPACE_STATE_KEY = "rustautomod.modVisibility";

export class ModVisibilityWorkspaceService {
    private readonly stateService: WorkspaceStateService<WorkspaceModVisibilityState>;

    constructor(context: vscode.ExtensionContext) {
        this.stateService = new WorkspaceStateService(
            context,
            WORKSPACE_STATE_KEY,
            normalizeWorkspaceState
        );
    }

    getState(workspaceFolder: vscode.WorkspaceFolder): WorkspaceModVisibilityState {
        return this.stateService.get(workspaceFolder);
    }

    async setAutoHide(workspaceFolder: vscode.WorkspaceFolder, enabled: boolean): Promise<void> {
        await this.stateService.update(workspaceFolder, state => ({
            ...state,
            autoHideIndexModRs: enabled
        }));
    }

    async setManuallyHidden(workspaceFolder: vscode.WorkspaceFolder, patterns: string[]): Promise<void> {
        await this.stateService.update(workspaceFolder, state => ({
            ...state,
            manuallyHidden: sortUnique(patterns)
        }));
    }

    async syncFilesExclude(
        workspaceFolder: vscode.WorkspaceFolder,
        desiredPatterns: string[]
    ): Promise<WorkspaceModVisibilityState> {
        const state = this.getState(workspaceFolder);
        const config = vscode.workspace.getConfiguration("files", workspaceFolder.uri);
        const currentExcludes = {
            ...(config.get<Record<string, FilesExcludeValue>>("exclude") ?? {})
        };
        const reconciliation = reconcileManagedExcludes(currentExcludes, desiredPatterns, state);
        const nextState = normalizeWorkspaceState({
            ...state,
            preservedExcludes: reconciliation.preservedExcludes,
            lastAppliedExcludes: reconciliation.lastAppliedExcludes
        });

        if (!areExcludeMapsEqual(currentExcludes, reconciliation.excludes)) {
            await config.update("exclude", reconciliation.excludes, vscode.ConfigurationTarget.WorkspaceFolder);
        }

        if (!areStatesEqual(state, nextState)) {
            await this.stateService.set(workspaceFolder, nextState);
        }

        return nextState;
    }
}

function normalizeWorkspaceState(
    value: Partial<WorkspaceModVisibilityState> | undefined
): WorkspaceModVisibilityState {
    const defaults = createDefaultWorkspaceModVisibilityState();
    return {
        autoHideIndexModRs: value?.autoHideIndexModRs ?? defaults.autoHideIndexModRs,
        manuallyHidden: sortUnique(value?.manuallyHidden ?? defaults.manuallyHidden),
        preservedExcludes: sortUnique(value?.preservedExcludes ?? defaults.preservedExcludes),
        lastAppliedExcludes: sortUnique(value?.lastAppliedExcludes ?? defaults.lastAppliedExcludes)
    };
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

function areStatesEqual(left: WorkspaceModVisibilityState, right: WorkspaceModVisibilityState): boolean {
    return left.autoHideIndexModRs === right.autoHideIndexModRs
        && arraysEqual(left.manuallyHidden, right.manuallyHidden)
        && arraysEqual(left.preservedExcludes, right.preservedExcludes)
        && arraysEqual(left.lastAppliedExcludes, right.lastAppliedExcludes);
}

function areExcludeMapsEqual(
    left: Record<string, FilesExcludeValue>,
    right: Record<string, FilesExcludeValue>
): boolean {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();

    if (!arraysEqual(leftKeys, rightKeys)) {
        return false;
    }

    return leftKeys.every(key => JSON.stringify(left[key]) === JSON.stringify(right[key]));
}
