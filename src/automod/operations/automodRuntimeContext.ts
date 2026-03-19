import vscode from "vscode";
import { AutomodOperationBatch } from "../../interfaces/automodoperation";
import { AutomodRuntime } from "../automodRuntime";

let runtime: AutomodRuntime | null = null;

export function configureAutomodRuntime(nextRuntime: AutomodRuntime): void {
    runtime = nextRuntime;
}

export function getAutomodRuntime(): AutomodRuntime {
    if (!runtime) {
        runtime = new AutomodRuntime();
    }

    return runtime;
}

export async function applyPlannedBatch(batch: AutomodOperationBatch, forcePreview = false): Promise<void> {
    const previewBeforeApply = forcePreview || vscode.workspace.getConfiguration("rustautomod").get<boolean>("previewBeforeApply", false);
    await getAutomodRuntime().applyBatch(batch, {
        preview: previewBeforeApply,
        confirmBeforeApply: previewBeforeApply,
        recordHistory: true
    });
}
