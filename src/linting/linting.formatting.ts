import * as vscode from "vscode";
import { formatRautomod } from "./rautomodFormatter";

const RAUTOMOD_DOCUMENT_SELECTOR: vscode.DocumentSelector = [{ language: "rautomod" }, { pattern: "**/.rautomod" }];

export const formattingProvider = vscode.languages.registerDocumentFormattingEditProvider(
    RAUTOMOD_DOCUMENT_SELECTOR,
    {
        provideDocumentFormattingEdits(document) {
            const original = document.getText();
            const formatted = formatRautomod(original);

            if (formatted === original) {
                return [];
            }

            const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(original.length)
            );

            return [vscode.TextEdit.replace(fullRange, formatted)];
        }
    }
);
