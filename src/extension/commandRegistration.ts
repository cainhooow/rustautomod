import * as vscode from "vscode";
import {
    configureAutomodRuntime,
    createModulePair,
    explainAutomod,
    ignorePathInRautomod,
    moveModuleToCrateRoot,
    openAutomodLog,
    previewAutomod,
    regenerateModules,
    scaffoldRautomod,
    setModuleVisibility,
    showEffectiveConfig,
    undoLastAutomodAction
} from "../automod/automodModFile";
import { AutomodRuntime } from "../automod/automodRuntime";
import { openRautomodRaw, openRautomodVisual, registerRautomodCustomEditor } from "../ui/rautomodCustomEditor";
import { openRautomodManager, registerRautomodManagerView } from "../ui/rautomodManagerView";
import { invalidateRautomodStudioCaches } from "../ui/studio/rautomodStudioCacheService";
import { ModVisibilityController } from "../workbench/control";

export function registerExtensionCommands(
    context: vscode.ExtensionContext,
    modVisibilityController: ModVisibilityController,
    automodRuntime: AutomodRuntime
): vscode.Disposable[] {
    configureAutomodRuntime(automodRuntime);

    return [
        vscode.commands.registerCommand(
            "rustautomod.toggleHideModRs",
            () => modVisibilityController.toggleAutoHideIndexModRs()
        ),
        vscode.commands.registerCommand(
            "rustautomod.hideThisModRs",
            (resource?: vscode.Uri) => modVisibilityController.hideThisModRs(resource)
        ),
        vscode.commands.registerCommand(
            "rustautomod.restoreHiddenModRs",
            (resource?: vscode.Uri) => modVisibilityController.restoreHiddenModRs(resource)
        ),
        vscode.commands.registerCommand(
            "rustautomod.previewAutomod",
            (resource?: vscode.Uri) => previewAutomod(resource)
        ),
        vscode.commands.registerCommand(
            "rustautomod.regenerateModules",
            (resource?: vscode.Uri) => regenerateModules(resource)
        ),
        vscode.commands.registerCommand(
            "rustautomod.undoLastAutomodAction",
            () => undoLastAutomodAction()
        ),
        vscode.commands.registerCommand(
            "rustautomod.explainAutomod",
            (resource?: vscode.Uri) => explainAutomod(resource)
        ),
        vscode.commands.registerCommand(
            "rustautomod.showEffectiveConfig",
            (resource?: vscode.Uri) => showEffectiveConfig(resource)
        ),
        vscode.commands.registerCommand(
            "rustautomod.ignorePathInRautomod",
            (resource?: vscode.Uri) => ignorePathInRautomod(resource)
        ),
        vscode.commands.registerCommand(
            "rustautomod.scaffoldRautomod",
            (resource?: vscode.Uri) => scaffoldRautomod(resource)
        ),
        vscode.commands.registerCommand(
            "rustautomod.createModulePair",
            (resource?: vscode.Uri) => createModulePair(resource)
        ),
        vscode.commands.registerCommand(
            "rustautomod.setModuleVisibility",
            (resource?: vscode.Uri, visibility?: "pub" | "pub(crate)" | "private") => setModuleVisibility(resource, visibility)
        ),
        vscode.commands.registerCommand(
            "rustautomod.moveModuleToCrateRoot",
            (resource?: vscode.Uri) => moveModuleToCrateRoot(resource)
        ),
        vscode.commands.registerCommand(
            "rustautomod.openLog",
            () => openAutomodLog()
        ),
        vscode.commands.registerCommand(
            "rustautomod.openRautomodVisual",
            (resource?: vscode.Uri) => openRautomodVisual(resource)
        ),
        vscode.commands.registerCommand(
            "rustautomod.openRautomodRaw",
            (resource?: vscode.Uri) => openRautomodRaw(resource)
        ),
        vscode.commands.registerCommand(
            "rustautomod.openManager",
            () => openRautomodManager(context)
        ),
        vscode.workspace.onDidChangeConfiguration(event => {
            modVisibilityController.handleConfigurationChange(event);
        }),
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            invalidateRautomodStudioCaches();
            void modVisibilityController.initialize();
        }),
        registerRautomodCustomEditor(context),
        registerRautomodManagerView(context)
    ];
}
