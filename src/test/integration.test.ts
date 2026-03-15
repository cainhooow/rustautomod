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
});

function getWorkspaceExcludes(workspaceFolder: vscode.WorkspaceFolder): Record<string, boolean> {
    return vscode.workspace.getConfiguration("files", workspaceFolder.uri)
        .get<Record<string, boolean>>("exclude", {});
}
