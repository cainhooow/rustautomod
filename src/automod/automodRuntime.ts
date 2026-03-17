import os from "os";
import path from "path";
import { promises as fs } from "fs";
import * as vscode from "vscode";
import { AutomodOperationBatch } from "../interfaces/automodoperation";
import { extractManagedDeclarationSignature } from "./modContentEditor";
import { runCargoFmt } from "./cargoFmt";
import { AutomodHistoryService } from "../workspace/automodHistoryService";
import { AutomodLogger } from "../workspace/automodLogger";

interface ApplyBatchOptions {
    preview?: boolean;
    confirmBeforeApply?: boolean;
    recordHistory?: boolean;
}

export class AutomodRuntime implements vscode.Disposable {
    private readonly history = new AutomodHistoryService();
    private readonly logger = new AutomodLogger();
    private readonly managedSignatures = new Map<string, string>();

    async applyBatch(batch: AutomodOperationBatch, options: ApplyBatchOptions = {}): Promise<boolean> {
        if (batch.changes.length === 0) {
            this.logger.info("automod.no_changes", { label: batch.label, sourcePath: batch.sourcePath });
            return false;
        }

        this.logger.info("automod.batch.start", {
            label: batch.label,
            sourcePath: batch.sourcePath,
            changeCount: batch.changes.length
        });

        if (options.preview) {
            await this.previewBatch(batch);
        }

        if (options.confirmBeforeApply) {
            const action = await vscode.window.showInformationMessage(
                `Rust AutoMod prepared ${batch.changes.length} change(s) for ${batch.label}.`,
                "Apply",
                "Skip"
            );

            if (action !== "Apply") {
                this.logger.warn("automod.batch.skipped", { label: batch.label, sourcePath: batch.sourcePath });
                return false;
            }
        }

        for (const change of batch.changes) {
            await this.warnOnManagedConflict(change.targetFilePath, change.beforeContent, change.afterContent);

            if (change.afterContent === null) {
                await fs.rm(change.targetFilePath, { force: true });
                this.managedSignatures.delete(change.targetFilePath);
                continue;
            }

            await fs.mkdir(path.dirname(change.targetFilePath), { recursive: true });
            await fs.writeFile(change.targetFilePath, change.afterContent, "utf8");
            if (change.formatAfterApply) {
                await runCargoFmt(change.targetFilePath);
            }
            await this.coordinateWithLanguageServices(change.targetFilePath);
            this.managedSignatures.set(
                change.targetFilePath,
                extractManagedDeclarationSignature(change.afterContent)
            );
        }

        if (options.recordHistory !== false) {
            this.history.push(batch);
        }

        this.logger.info("automod.batch.applied", {
            label: batch.label,
            sourcePath: batch.sourcePath,
            changeCount: batch.changes.length
        });
        return true;
    }

    async previewBatch(batch: AutomodOperationBatch): Promise<void> {
        const markdown = [
            `# Rust AutoMod Preview`,
            ``,
            `Operation: \`${batch.label}\``,
            batch.sourcePath ? `Source: \`${batch.sourcePath}\`` : undefined,
            `Changes: ${batch.changes.length}`,
            ``,
            ...batch.changes.map(change => `- \`${change.targetFilePath}\`: ${change.reason}`)
        ].filter(Boolean).join("\n");

        const previewDocument = await vscode.workspace.openTextDocument({
            language: "markdown",
            content: markdown
        });
        await vscode.window.showTextDocument(previewDocument, { preview: true });

        const firstChange = batch.changes[0];
        if (!firstChange) {
            return;
        }

        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rustautomod-preview-"));
        const beforePath = path.join(tempDir, `before-${path.basename(firstChange.targetFilePath)}`);
        const afterPath = path.join(tempDir, `after-${path.basename(firstChange.targetFilePath)}`);

        await fs.writeFile(beforePath, firstChange.beforeContent ?? "", "utf8");
        await fs.writeFile(afterPath, firstChange.afterContent ?? "", "utf8");

        await vscode.commands.executeCommand(
            "vscode.diff",
            vscode.Uri.file(beforePath),
            vscode.Uri.file(afterPath),
            `Rust AutoMod Preview: ${path.basename(firstChange.targetFilePath)}`
        );

        this.logger.info("automod.batch.preview", {
            label: batch.label,
            sourcePath: batch.sourcePath,
            changeCount: batch.changes.length,
            firstChange: firstChange.targetFilePath
        });
    }

    async undoLast(): Promise<boolean> {
        const batch = await this.history.undoLast();
        if (!batch) {
            vscode.window.showInformationMessage("Rust AutoMod has no action to undo.");
            return false;
        }

        for (const change of batch.changes) {
            if (change.beforeContent === null) {
                this.managedSignatures.delete(change.targetFilePath);
                continue;
            }

            this.managedSignatures.set(change.targetFilePath, extractManagedDeclarationSignature(change.beforeContent));
        }

        this.logger.info("automod.batch.undo", {
            label: batch.label,
            sourcePath: batch.sourcePath,
            changeCount: batch.changes.length
        });
        return true;
    }

    showLog(): void {
        this.logger.show();
    }

    dispose(): void {
        this.logger.dispose();
    }

    private async warnOnManagedConflict(
        targetFilePath: string,
        beforeContent: string | null,
        afterContent: string | null
    ): Promise<void> {
        if (beforeContent === null || afterContent === null) {
            return;
        }

        const previousSignature = this.managedSignatures.get(targetFilePath);
        if (!previousSignature) {
            this.managedSignatures.set(targetFilePath, extractManagedDeclarationSignature(afterContent));
            return;
        }

        const currentSignature = extractManagedDeclarationSignature(beforeContent);
        if (currentSignature === previousSignature) {
            return;
        }

        this.logger.warn("automod.conflict_detected", { targetFilePath });
        void vscode.window.showWarningMessage(
            `Rust AutoMod detected manual edits in the managed declaration area of ${path.basename(targetFilePath)}.`
        );
    }

    private async coordinateWithLanguageServices(targetFilePath: string): Promise<void> {
        const uri = vscode.Uri.file(targetFilePath);

        try {
            await vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", uri);
        } catch (error) {
            this.logger.warn("automod.language_services.unavailable", {
                targetFilePath,
                error: error instanceof Error ? error.message : String(error)
            });
            return;
        }

        const diagnostics = vscode.languages.getDiagnostics(uri)
            .filter(diagnostic => diagnostic.severity === vscode.DiagnosticSeverity.Error)
            .slice(0, 5)
            .map(diagnostic => ({
                message: diagnostic.message,
                line: diagnostic.range.start.line + 1
            }));

        if (diagnostics.length > 0) {
            this.logger.warn("automod.language_services.diagnostics", {
                targetFilePath,
                diagnostics
            });
        }
    }
}
