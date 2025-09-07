import * as vscode from "vscode";

export async function hiddenModFiles() {
    const config = vscode.workspace.getConfiguration();
    const key = "**/mod.rs";
    const excludes = { ...(config.get<Record<string, boolean>>("files.exclude") || {}) };
    const currentlyHidden = excludes[key] === true;

    if (currentlyHidden) {
        delete excludes[key];
        vscode.window.showInformationMessage("Showing mod.rs files again");
    } else {
        excludes[key] = true;
        vscode.window.showInformationMessage("Hiding mod.rs files");
    }

    const target = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0)
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;

    await config.update("files.exclude", excludes, target);
}