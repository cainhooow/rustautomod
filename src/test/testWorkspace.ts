import * as os from "os";
import * as path from "path";
import { promises as fs } from "fs";
import * as vscode from "vscode";

const EXTENSION_NAME = "rustautomod";

export interface WorkspaceFolderSnapshot {
    name: string;
    uri: vscode.Uri;
}

export async function activateCurrentExtension(): Promise<vscode.Extension<unknown>> {
    const extension = vscode.extensions.all.find(candidate => candidate.packageJSON.name === EXTENSION_NAME);
    if (!extension) {
        throw new Error(`Extension '${EXTENSION_NAME}' was not found in the current test host.`);
    }

    if (!extension.isActive) {
        await extension.activate();
    }

    return extension;
}

export async function createTempRustWorkspace(prefix = "rust-automod-test-"): Promise<string> {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    await fs.writeFile(
        path.join(workspacePath, "Cargo.toml"),
        `[package]
name = "test-project"
version = "0.1.0"
edition = "2021"
`,
        "utf8"
    );

    return workspacePath;
}

export async function addWorkspaceFolder(folderPath: string): Promise<vscode.WorkspaceFolder> {
    const updated = vscode.workspace.updateWorkspaceFolders(
        vscode.workspace.workspaceFolders?.length ?? 0,
        null,
        { uri: vscode.Uri.file(folderPath), name: path.basename(folderPath) }
    );

    if (!updated) {
        throw new Error(`Failed to add workspace folder: ${folderPath}`);
    }

    await waitForCondition(
        () => Boolean(vscode.workspace.getWorkspaceFolder(vscode.Uri.file(folderPath))),
        3000,
        50
    );

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(folderPath));
    if (!workspaceFolder) {
        throw new Error(`Workspace folder was not available after add: ${folderPath}`);
    }

    return workspaceFolder;
}

export function snapshotWorkspaceFolders(): WorkspaceFolderSnapshot[] {
    return (vscode.workspace.workspaceFolders ?? []).map(folder => ({
        name: folder.name,
        uri: folder.uri
    }));
}

export async function replaceWorkspaceFolders(folders: WorkspaceFolderSnapshot[]): Promise<void> {
    const currentLength = vscode.workspace.workspaceFolders?.length ?? 0;
    const updated = vscode.workspace.updateWorkspaceFolders(0, currentLength, ...folders);

    if (!updated) {
        throw new Error("Failed to replace workspace folders for the test.");
    }

    await waitForCondition(
        () => {
            const currentFolders = vscode.workspace.workspaceFolders ?? [];
            if (currentFolders.length !== folders.length) {
                return false;
            }

            return currentFolders.every((folder, index) => folder.uri.toString() === folders[index].uri.toString());
        },
        3000,
        50
    );
}

export async function removeWorkspaceFolder(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
    const index = vscode.workspace.workspaceFolders?.findIndex(folder => folder.uri.toString() === workspaceFolder.uri.toString()) ?? -1;
    if (index < 0) {
        return;
    }

    const updated = vscode.workspace.updateWorkspaceFolders(index, 1);
    if (!updated) {
        throw new Error(`Failed to remove workspace folder: ${workspaceFolder.uri.fsPath}`);
    }

    await waitForCondition(
        () => !vscode.workspace.workspaceFolders?.some(folder => folder.uri.toString() === workspaceFolder.uri.toString()),
        3000,
        50
    );
}

export async function deleteDirectory(directoryPath: string): Promise<void> {
    const maxAttempts = 10;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await fs.rm(directoryPath, { recursive: true, force: true });
            return;
        } catch (error) {
            if (!isRetryableDeleteError(error) || attempt === maxAttempts) {
                throw error;
            }

            await delay(100 * attempt);
        }
    }
}

export async function waitForCondition(
    predicate: () => boolean | Promise<boolean>,
    timeoutMs = 5000,
    intervalMs = 50
): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        if (await predicate()) {
            return;
        }

        await delay(intervalMs);
    }

    throw new Error(`Condition was not met within ${timeoutMs}ms.`);
}

export async function delay(milliseconds: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, milliseconds));
}

function isRetryableDeleteError(error: unknown): boolean {
    if (!error || typeof error !== "object" || !("code" in error)) {
        return false;
    }

    return error.code === "EBUSY" || error.code === "EPERM" || error.code === "ENOTEMPTY";
}
