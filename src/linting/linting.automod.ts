import path from "path";
import * as vscode from "vscode";

export function validateRautomod(doc: vscode.TextDocument, diagnosticCollection: vscode.DiagnosticCollection) {
    if (path.basename(doc.fileName) !== ".rautomod") {
        diagnosticCollection.delete(doc.uri);
        return;
    }

    const diagnostics: vscode.Diagnostic[] = [];
    const lines = doc.getText().split(/\r?\n/);
    lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith("#")) return;

        if (/^visibility\s*=/.test(trimmed)) {
            if (!/^visibility\s*=\s*(pub|private)$/.test(trimmed)) {
                diagnostics.push(createDiagnostic(index, "visibility accepts only 'pub' or 'private'"));
            }
        } else if (/^sort\s*=/.test(trimmed)) {
            if (!/^sort\s*=\s*(alpha|none)$/.test(trimmed)) {
                diagnostics.push(createDiagnostic(index, "sort accepts only 'alpha' or 'none'"));
            }
        } else if (/^pattern\s*=/.test(trimmed)) {
            const values = trimmed.split("=")[1].split(",").map(s => s.trim());
            if (values.some(v => v === "")) {
                diagnostics.push(createDiagnostic(index, "pattern values cannot be empty"));
            }
        } else if (/^cfg\s*=/.test(trimmed)) {
            const values = trimmed.split("=")[1].split(",").map(s => s.trim());
            if (values.some(v => v === "")) {
                diagnostics.push(createDiagnostic(index, "cfg values cannot be empty"));
            }
        } else if (/^fmt\s*=/.test(trimmed)) {
            if (!/^fmt\s*=\s*(enabled|disabled)$/.test(trimmed)) {
                diagnostics.push(createDiagnostic(index, "fmt accepts only 'enabled' or 'disabled'"));
            }
        } else {
            diagnostics.push(createDiagnostic(index, "invalid line in .rautomod"));
        }
    })

    diagnosticCollection.set(doc.uri, diagnostics);
}

function createDiagnostic(line: number, message: string): vscode.Diagnostic {
    return new vscode.Diagnostic(
        new vscode.Range(line, 0, line, Number.MAX_VALUE),
        message,
        vscode.DiagnosticSeverity.Error
    );
}