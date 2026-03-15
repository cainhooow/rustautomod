import * as assert from "assert";
import * as os from "os";
import * as path from "path";
import { promises as fs } from "fs";
import { handleFileDelete, handleFileRename, handleNewFile } from "../automod/automodModFile";
import { isBlacklistedPath, isValidRustPath } from "../utils/pathValidator";

suite("Git Safety", () => {
    let workspacePath: string;

    setup(async () => {
        workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "rust-automod-git-safety-"));
        await fs.writeFile(
            path.join(workspacePath, "Cargo.toml"),
            `[package]
name = "git-safety"
version = "0.1.0"
edition = "2021"
`,
            "utf8"
        );
        await fs.mkdir(path.join(workspacePath, ".git"), { recursive: true });
        await fs.mkdir(path.join(workspacePath, "src"), { recursive: true });
    });

    teardown(async () => {
        await fs.rm(workspacePath, { recursive: true, force: true });
    });

    test("blacklists .git paths before any automod write", () => {
        const gitRustFile = path.join(workspacePath, ".git", "rebase_head.rs");

        assert.strictEqual(isBlacklistedPath(gitRustFile), true);
        assert.strictEqual(isValidRustPath(gitRustFile), false);
    });

    test("does not create or update mod.rs for files inside .git", async () => {
        const gitRustFile = path.join(workspacePath, ".git", "rebase_head.rs");
        const gitModFile = path.join(workspacePath, ".git", "mod.rs");
        const srcModFile = path.join(workspacePath, "src", "mod.rs");

        await fs.writeFile(gitRustFile, "pub fn temp() {}\n", "utf8");
        await handleNewFile({ fsPath: gitRustFile } as unknown as Parameters<typeof handleNewFile>[0]);

        const gitModExists = await exists(gitModFile);
        const srcModExists = await exists(srcModFile);

        assert.strictEqual(gitModExists, false);
        assert.strictEqual(srcModExists, false);
    });

    test("does not update mod.rs when deleting a file inside .git", async () => {
        const gitRustFile = path.join(workspacePath, ".git", "rebase_head.rs");
        const gitModFile = path.join(workspacePath, ".git", "mod.rs");
        const originalContent = "pub mod keep_me;\n";

        await fs.writeFile(gitRustFile, "pub fn temp() {}\n", "utf8");
        await fs.writeFile(gitModFile, originalContent, "utf8");

        await handleFileDelete({ fsPath: gitRustFile } as unknown as Parameters<typeof handleFileDelete>[0]);

        const updatedContent = await fs.readFile(gitModFile, "utf8");
        assert.strictEqual(updatedContent, originalContent);
    });

    test("does not update mod.rs when renaming files inside .git", async () => {
        const oldGitRustFile = path.join(workspacePath, ".git", "old_name.rs");
        const newGitRustFile = path.join(workspacePath, ".git", "new_name.rs");
        const gitModFile = path.join(workspacePath, ".git", "mod.rs");
        const originalContent = "pub mod keep_me;\npub mod zzz;\n";

        await fs.writeFile(oldGitRustFile, "pub fn temp() {}\n", "utf8");
        await fs.writeFile(gitModFile, originalContent, "utf8");

        await handleFileRename(
            { fsPath: oldGitRustFile } as unknown as Parameters<typeof handleFileRename>[0],
            { fsPath: newGitRustFile } as unknown as Parameters<typeof handleFileRename>[1]
        );

        const updatedContent = await fs.readFile(gitModFile, "utf8");
        assert.strictEqual(updatedContent, originalContent);
    });
});

async function exists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}
