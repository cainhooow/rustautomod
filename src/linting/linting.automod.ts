import path from "path";
import * as vscode from "vscode";
import { parseRautomodDocument } from "../automod/automodConfigFile";

export function validateRautomod(doc: vscode.TextDocument, diagnosticCollection: vscode.DiagnosticCollection) {
    if (path.basename(doc.fileName) !== ".rautomod") {
        diagnosticCollection.delete(doc.uri);
        return;
    }

    const parsed = parseRautomodDocument(doc.getText(), doc.fileName);
    const diagnostics = parsed.diagnostics
        .filter(diagnostic => parsed.strictMode !== "off" || diagnostic.severity === "error")
        .map(diagnostic => {
            const severity = diagnostic.severity === "error"
                ? vscode.DiagnosticSeverity.Error
                : parsed.strictMode === "error"
                    ? vscode.DiagnosticSeverity.Error
                    : vscode.DiagnosticSeverity.Warning;

            const createdDiagnostic = new vscode.Diagnostic(
                new vscode.Range(diagnostic.line, 0, diagnostic.line, Number.MAX_VALUE),
                diagnostic.message,
                severity
            );
            createdDiagnostic.code = diagnostic.code;
            createdDiagnostic.source = "rustautomod";
            return createdDiagnostic;
        });

    diagnosticCollection.set(doc.uri, diagnostics);
}
