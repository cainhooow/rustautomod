import * as vscode from "vscode";
import { completionProvider } from "./linting/linting.completion";
import { formattingProvider } from "./linting/linting.formatting";
import { rautomodCodeActions } from "./linting/linting.codeActions";
import { AutomodRuntime } from "./automod/automodRuntime";
import { ModVisibilityController } from "./workbench/control";
import { registerExtensionCommands } from "./extension/commandRegistration";
import { registerDocumentValidation } from "./extension/documentValidation";
import { RustFileLifecycleWatcher } from "./extension/rustFileLifecycleWatcher";

export function activate(context: vscode.ExtensionContext) {
    console.log("RUST AUTOMOD INIT");

    const automodRuntime = new AutomodRuntime();
    const modVisibilityController = new ModVisibilityController(context);
    const diagnosticCollection = vscode.languages.createDiagnosticCollection("rustautomod");
    const rustFileLifecycleWatcher = new RustFileLifecycleWatcher(modVisibilityController);

    context.subscriptions.push(
        ...registerExtensionCommands(context, modVisibilityController, automodRuntime),
        ...registerDocumentValidation(diagnosticCollection),
        rustFileLifecycleWatcher,
        automodRuntime,
        modVisibilityController,
        diagnosticCollection,
        completionProvider,
        rautomodCodeActions,
        formattingProvider
    );

    console.log("RUST AUTOMOD: Active with path validation enabled");
    console.log("RUST AUTOMOD: Protected directories: .git, target, node_modules, and more");
    void modVisibilityController.initialize();
}

export function deactivate() { }
