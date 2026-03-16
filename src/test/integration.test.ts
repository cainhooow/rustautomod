import * as assert from "assert";
import * as path from "path";
import { promises as fs } from "fs";
import * as vscode from "vscode";
import {
    activateCurrentExtension,
    addWorkspaceFolder,
    createTempRustWorkspace,
    deleteDirectory,
    removeWorkspaceFolder,
    waitForCondition
} from "./testWorkspace";

suite("Extension Integration", () => {
    let workspacePath: string;
    let workspaceFolder: vscode.WorkspaceFolder;

    suiteSetup(async function () {
        this.timeout(10000);
        workspacePath = await createTempRustWorkspace();
        await fs.mkdir(path.join(workspacePath, "src"), { recursive: true });
        workspaceFolder = await addWorkspaceFolder(workspacePath);
        await activateCurrentExtension();
    });

    suiteTeardown(async function () {
        this.timeout(10000);
        try {
            await vscode.commands.executeCommand("workbench.action.closeAllEditors");
            await removeWorkspaceFolder(workspaceFolder);
        } catch (error) {
            console.warn("RUST AUTOMOD TEST: Failed to remove temporary workspace folder cleanly.", error);
        }
        await deleteDirectory(workspacePath);
    });

    setup(async function () {
        this.timeout(10000);
        await fs.rm(path.join(workspacePath, "src"), { recursive: true, force: true });
        await fs.mkdir(path.join(workspacePath, "src"), { recursive: true });
        await fs.rm(path.join(workspacePath, ".rautomod"), { force: true });
        await vscode.workspace.getConfiguration("rustautomod", workspaceFolder.uri)
            .update("previewBeforeApply", false, vscode.ConfigurationTarget.Workspace);
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    });

    test("toggle smart hiding only hides index-like mod.rs and can revert", async function () {
        this.timeout(10000);

        const hiddenMod = path.join(workspacePath, "src", "feature", "mod.rs");
        const visibleMod = path.join(workspacePath, "src", "rich", "mod.rs");

        await fs.mkdir(path.dirname(hiddenMod), { recursive: true });
        await fs.mkdir(path.dirname(visibleMod), { recursive: true });
        await fs.writeFile(hiddenMod, "pub mod api;\npub use self::api::Client;\n", "utf8");
        await fs.writeFile(visibleMod, "pub mod api;\npub fn helper() {}\n", "utf8");

        await vscode.commands.executeCommand("rustautomod.toggleHideModRs");

        try {
            await waitForCondition(() => {
                const excludes = getWorkspaceExcludes(workspaceFolder);
                return excludes["src/feature/mod.rs"] === true && excludes["src/rich/mod.rs"] !== true;
            }, 5000, 100);
        } finally {
            await vscode.commands.executeCommand("rustautomod.toggleHideModRs");
        }

        await waitForCondition(() => {
            const excludes = getWorkspaceExcludes(workspaceFolder);
            return excludes["src/feature/mod.rs"] !== true;
        }, 5000, 100);
    });

    test("manual hide and restore update files.exclude for a specific mod.rs", async function () {
        this.timeout(10000);

        const targetMod = path.join(workspacePath, "src", "manual", "mod.rs");
        await fs.mkdir(path.dirname(targetMod), { recursive: true });
        await fs.writeFile(targetMod, "pub fn helper() {}\n", "utf8");

        await vscode.commands.executeCommand("rustautomod.hideThisModRs", vscode.Uri.file(targetMod));

        await waitForCondition(() => getWorkspaceExcludes(workspaceFolder)["src/manual/mod.rs"] === true, 5000, 100);

        await vscode.commands.executeCommand("rustautomod.restoreHiddenModRs", vscode.Uri.file(targetMod));

        await waitForCondition(() => getWorkspaceExcludes(workspaceFolder)["src/manual/mod.rs"] !== true, 5000, 100);
    });

    test("recognizes .rautomod as its own language and formats the document", async function () {
        this.timeout(10000);

        const configPath = path.join(workspacePath, ".rautomod");
        await fs.writeFile(
            configPath,
            `  # project defaults
visibility = pub

pattern = utils, helpers
cfg = feature="serde", all(unix, target_pointer_width = "64")
`,
            "utf8"
        );

        const document = await vscode.workspace.openTextDocument(configPath);
        assert.strictEqual(document.languageId, "rautomod");

        const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
            "vscode.executeFormatDocumentProvider",
            document.uri
        );

        assert.ok(edits && edits.length > 0);

        const workspaceEdit = new vscode.WorkspaceEdit();
        workspaceEdit.set(document.uri, edits);
        await vscode.workspace.applyEdit(workspaceEdit);

        const formattedDocument = await vscode.workspace.openTextDocument(configPath);
        assert.strictEqual(
            formattedDocument.getText(),
            `# project defaults
visibility=pub

pattern=utils,helpers
cfg=feature="serde",all(unix, target_pointer_width = "64")
`
        );
    });

    test("smart hiding reacts when a hidden mod.rs gains real content", async function () {
        this.timeout(10000);

        const targetMod = path.join(workspacePath, "src", "dynamic", "mod.rs");
        await fs.mkdir(path.dirname(targetMod), { recursive: true });
        await fs.writeFile(targetMod, "pub mod api;\n", "utf8");

        await vscode.commands.executeCommand("rustautomod.toggleHideModRs");
        try {
            await waitForCondition(() => getWorkspaceExcludes(workspaceFolder)["src/dynamic/mod.rs"] === true, 5000, 100);

            await fs.writeFile(targetMod, "pub mod api;\npub fn helper() {}\n", "utf8");

            await waitForCondition(() => getWorkspaceExcludes(workspaceFolder)["src/dynamic/mod.rs"] !== true, 5000, 100);
        } finally {
            await vscode.commands.executeCommand("rustautomod.toggleHideModRs");
        }
    });

    test("scaffolds a .rautomod file from the workspace folder", async function () {
        this.timeout(10000);

        await vscode.commands.executeCommand("rustautomod.scaffoldRautomod", workspaceFolder.uri);

        const configPath = path.join(workspacePath, ".rautomod");
        const content = await fs.readFile(configPath, "utf8");
        assert.ok(content.includes("schema_version=1"));
        assert.ok(content.includes("group_order=use,cfg,pub_mod,mod,pub_use"));
    });

    test("ignores a folder by prepending an exclude rule to .rautomod", async function () {
        this.timeout(10000);

        const ignoredFolder = path.join(workspacePath, "src", "generated");
        await fs.mkdir(ignoredFolder, { recursive: true });

        await vscode.commands.executeCommand("rustautomod.ignorePathInRautomod", vscode.Uri.file(ignoredFolder));

        const configContent = await fs.readFile(path.join(workspacePath, ".rautomod"), "utf8");
        assert.ok(configContent.startsWith("exclude=src/generated/**"));
    });

    test("preview automod shows changes without writing them", async function () {
        this.timeout(10000);

        const previewFolder = path.join(workspacePath, "src", "preview");
        const previewMod = path.join(previewFolder, "mod.rs");
        await fs.mkdir(previewFolder, { recursive: true });
        await fs.writeFile(previewMod, "pub mod ghost;\n", "utf8");

        await vscode.commands.executeCommand("rustautomod.previewAutomod", vscode.Uri.file(previewFolder));
        await new Promise(resolve => setTimeout(resolve, 300));

        const contentAfterPreview = await fs.readFile(previewMod, "utf8");
        assert.strictEqual(contentAfterPreview, "pub mod ghost;\n");
    });

    test("regenerates stale modules and can undo the last automod action", async function () {
        this.timeout(10000);

        const staleFolder = path.join(workspacePath, "src", "stale");
        const staleMod = path.join(staleFolder, "mod.rs");
        await fs.mkdir(staleFolder, { recursive: true });
        await fs.writeFile(staleMod, "pub mod ghost;\n", "utf8");

        await vscode.commands.executeCommand("rustautomod.regenerateModules", vscode.Uri.file(staleFolder));

        await waitForCondition(async () => {
            try {
                await fs.access(staleMod);
                return false;
            } catch {
                return true;
            }
        }, 5000, 100);

        await vscode.commands.executeCommand("rustautomod.undoLastAutomodAction");

        await waitForCondition(async () => {
            try {
                return (await fs.readFile(staleMod, "utf8")) === "pub mod ghost;\n";
            } catch {
                return false;
            }
        }, 5000, 100);
    });

    test("shows the effective config for a rust file", async function () {
        this.timeout(10000);

        const configPath = path.join(workspacePath, ".rautomod");
        const targetFile = path.join(workspacePath, "src", "effective", "feature.rs");
        await fs.mkdir(path.dirname(targetFile), { recursive: true });
        await fs.writeFile(configPath, "pattern=src/effective/**\nvisibility=private\n", "utf8");
        await fs.writeFile(targetFile, "pub fn demo() {}\n", "utf8");

        await vscode.commands.executeCommand("rustautomod.showEffectiveConfig", vscode.Uri.file(targetFile));

        const activeDocument = vscode.window.activeTextEditor?.document;
        assert.ok(activeDocument);
        assert.strictEqual(activeDocument?.languageId, "markdown");
        assert.ok(activeDocument?.getText().includes("Effective Rust AutoMod Config"));
        assert.ok(activeDocument?.getText().includes("\"visibility\": \"private\""));
    });
});

function getWorkspaceExcludes(workspaceFolder: vscode.WorkspaceFolder): Record<string, boolean> {
    return vscode.workspace.getConfiguration("files", workspaceFolder.uri)
        .get<Record<string, boolean>>("exclude", {});
}
