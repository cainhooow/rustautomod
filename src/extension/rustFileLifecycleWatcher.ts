import * as path from "path";
import * as vscode from "vscode";
import {
    handleFileDelete,
    handleFileRename,
    handleNewFile
} from "../automod/automodModFile";
import { invalidateRautomodStudioCaches } from "../ui/studio/rautomodStudioCacheService";
import { isValidRustPath } from "../utils/pathValidator";
import { ModVisibilityController } from "../workbench/control";

export class RustFileLifecycleWatcher implements vscode.Disposable {
    private readonly watcher = vscode.workspace.createFileSystemWatcher("**/*.rs", false, false, false);
    private readonly pendingCreatedUris = new Set<string>();
    private readonly pendingDeletedUris = new Set<string>();
    private readonly pendingRenames = new Map<string, string>();
    private readonly pendingRenameTargets = new Set<string>();
    private readonly recentDeletes = new Map<string, { timestamp: number; fileName: string }>();
    private readonly debounceDelay = 500;
    private readonly renameDetectionWindow = 300;
    private debounceTimeout: NodeJS.Timeout | null = null;

    constructor(private readonly modVisibilityController: ModVisibilityController) {
        this.watcher.onDidCreate(uri => {
            void this.handleCreate(uri);
        });
        this.watcher.onDidDelete(uri => {
            void this.handleDelete(uri);
        });
        this.watcher.onDidChange(uri => {
            this.handleChange(uri);
        });
    }

    dispose(): void {
        if (this.debounceTimeout) {
            clearTimeout(this.debounceTimeout);
            this.debounceTimeout = null;
        }

        this.pendingCreatedUris.clear();
        this.pendingDeletedUris.clear();
        this.pendingRenameTargets.clear();
        this.pendingRenames.clear();
        this.recentDeletes.clear();
        this.watcher.dispose();
    }

    private async processBatch(): Promise<void> {
        const createdUris = Array.from(this.pendingCreatedUris);
        const deletedUris = Array.from(this.pendingDeletedUris);
        const renames = Array.from(this.pendingRenames.entries());

        this.pendingCreatedUris.clear();
        this.pendingDeletedUris.clear();
        this.pendingRenameTargets.clear();
        this.pendingRenames.clear();
        this.debounceTimeout = null;

        if (createdUris.length === 0 && deletedUris.length === 0 && renames.length === 0) {
            return;
        }

        if (renames.length > 0) {
            console.log(`RUST AUTOMOD: Processing ${renames.length} renames (waiting for Rust Analyzer)...`);
            await new Promise(resolve => setTimeout(resolve, 1000));

            await Promise.all(renames.map(([oldPath, newPath]) => (
                handleFileRename(vscode.Uri.file(oldPath), vscode.Uri.file(newPath))
                    .catch(error => {
                        console.error(`RUST AUTOMOD ERROR: Error renaming ${oldPath} -> ${newPath}:`, error);
                    })
            )));
        }

        if (deletedUris.length > 0) {
            await Promise.all(deletedUris.map(targetPath => (
                handleFileDelete(vscode.Uri.file(targetPath)).catch(error => {
                    console.error(`RUST AUTOMOD ERROR: Error deleting ${targetPath}:`, error);
                })
            )));
        }

        if (createdUris.length > 0) {
            await Promise.all(createdUris.map(targetPath => (
                handleNewFile(vscode.Uri.file(targetPath)).catch(error => {
                    console.error(`RUST AUTOMOD ERROR: Error creating ${targetPath}:`, error);
                })
            )));
        }

        console.log("RUST AUTOMOD: Batch process completed");
    }

    private scheduleBatchProcessing(): void {
        console.log("RUST AUTOMOD: Batch processing scheduled");

        if (this.debounceTimeout) {
            clearTimeout(this.debounceTimeout);
        }

        this.debounceTimeout = setTimeout(() => {
            void this.processBatch();
        }, this.debounceDelay);
    }

    private async handleCreate(uri: vscode.Uri): Promise<void> {
        const filePath = uri.fsPath;

        if (path.basename(filePath) === "mod.rs") {
            this.modVisibilityController.scheduleRefresh(uri, true);
        }
        invalidateRautomodStudioCaches();

        if (!isValidRustPath(filePath)) {
            console.log(`RUST AUTOMOD: Ignoring create event for invalid path: ${filePath}`);
            return;
        }

        const fileName = path.basename(filePath, ".rs");
        const dirPath = path.dirname(filePath);

        if (this.pendingDeletedUris.has(filePath)) {
            this.pendingDeletedUris.delete(filePath);
            console.log(`RUST AUTOMOD: Cancelled deletion for ${filePath} (file created)`);
            return;
        }

        if (this.pendingRenameTargets.has(filePath)) {
            console.log(`RUST AUTOMOD: Skipping create for ${filePath} (part of rename)`);
            return;
        }

        const now = Date.now();
        let bestMatch: string | null = null;
        let bestScore = -1;

        for (const [deletedPath, info] of this.recentDeletes.entries()) {
            const timeDiff = now - info.timestamp;
            if (timeDiff >= this.renameDetectionWindow) {
                this.recentDeletes.delete(deletedPath);
                continue;
            }

            if (path.dirname(deletedPath) !== dirPath || !deletedPath.endsWith(".rs")) {
                continue;
            }

            let nameScore = 0;
            for (let index = 0; index < Math.min(info.fileName.length, fileName.length); index += 1) {
                if (info.fileName[index] === fileName[index]) {
                    nameScore += 1;
                } else {
                    break;
                }
            }

            const timeScore = 1 - (timeDiff / this.renameDetectionWindow);
            const totalScore = (nameScore * 10) + timeScore;

            if (totalScore > bestScore) {
                bestScore = totalScore;
                bestMatch = deletedPath;
            }
        }

        if (bestMatch && bestScore > 0) {
            console.log(`RUST AUTOMOD: Detected rename ${bestMatch} -> ${filePath} (score: ${bestScore.toFixed(2)})`);
            this.pendingRenames.set(bestMatch, filePath);
            this.pendingRenameTargets.add(filePath);
            this.recentDeletes.delete(bestMatch);
            this.scheduleBatchProcessing();
            return;
        }

        this.pendingCreatedUris.add(filePath);
        this.scheduleBatchProcessing();
    }

    private async handleDelete(uri: vscode.Uri): Promise<void> {
        const filePath = uri.fsPath;

        if (path.basename(filePath) === "mod.rs") {
            this.modVisibilityController.scheduleRefresh(uri, true);
        }
        invalidateRautomodStudioCaches();

        if (!isValidRustPath(filePath)) {
            console.log(`RUST AUTOMOD: Ignoring delete event for invalid path: ${filePath}`);
            return;
        }

        if (this.pendingCreatedUris.has(filePath)) {
            this.pendingCreatedUris.delete(filePath);
            console.log(`RUST AUTOMOD: Cancelled creation for ${filePath} (file deleted)`);
            return;
        }

        if (this.pendingRenames.has(filePath)) {
            console.log(`RUST AUTOMOD: Skipping delete for ${filePath} (part of rename)`);
            return;
        }

        if (filePath.endsWith(".rs")) {
            this.recentDeletes.set(filePath, {
                timestamp: Date.now(),
                fileName: path.basename(filePath, ".rs")
            });

            setTimeout(() => {
                if (this.recentDeletes.has(filePath)) {
                    this.recentDeletes.delete(filePath);
                    if (!this.pendingRenames.has(filePath)) {
                        this.pendingDeletedUris.add(filePath);
                        this.scheduleBatchProcessing();
                    }
                }
            }, this.renameDetectionWindow + 50);

            return;
        }

        this.pendingDeletedUris.add(filePath);
        this.scheduleBatchProcessing();
    }

    private handleChange(uri: vscode.Uri): void {
        if (path.basename(uri.fsPath) === "mod.rs") {
            this.modVisibilityController.scheduleRefresh(uri);
        }

        invalidateRautomodStudioCaches();
    }
}
