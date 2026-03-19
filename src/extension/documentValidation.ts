import * as vscode from "vscode";
import { validateRautomod } from "../linting/linting.automod";
import { isValidRustPath } from "../utils/pathValidator";
import { invalidateRautomodStudioCaches } from "../ui/studio/rautomodStudioCacheService";

export function registerDocumentValidation(diagnosticCollection: vscode.DiagnosticCollection): vscode.Disposable[] {
    return [
        vscode.workspace.onDidOpenTextDocument(doc => validateRautomod(doc, diagnosticCollection)),
        vscode.workspace.onDidSaveTextDocument(doc => {
            validateRautomod(doc, diagnosticCollection);
            if (shouldInvalidateStudioCache(doc.uri.fsPath)) {
                invalidateRautomodStudioCaches();
            }
        }),
        vscode.workspace.onDidChangeTextDocument(event => validateRautomod(event.document, diagnosticCollection))
    ];
}

function shouldInvalidateStudioCache(filePath: string): boolean {
    return filePath.endsWith(".rautomod")
        || (filePath.endsWith(".rs") && isValidRustPath(filePath));
}
