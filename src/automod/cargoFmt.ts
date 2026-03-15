import * as vscode from "vscode";
import { execFile } from "child_process";
import { promisify } from "util";
import { findCargoRoot } from "../utils/pathValidator";

const execFileAsync = promisify(execFile);

export async function runCargoFmt(filePath: string): Promise<void> {
    const projectRoot = findCargoRoot(filePath);
    if (!projectRoot) {
        console.log("RUST AUTOMOD: Cargo.toml not found. Skipping 'cargo fmt'.");
        return;
    }

    try {
        await execFileAsync("cargo", ["fmt"], { cwd: projectRoot });
        console.log(`RUST AUTOMOD: 'cargo fmt' executed successfully in ${projectRoot}.`);
    } catch (error) {
        const stderr = getExecErrorOutput(error);
        vscode.window.showErrorMessage(`Failed to run 'cargo fmt': ${stderr}`);
        console.error(`RUST AUTOMOD 'cargo fmt' error: ${stderr}`);
    }
}

function getExecErrorOutput(error: unknown): string {
    if (typeof error === "object" && error !== null && "stderr" in error) {
        const stderr = (error as { stderr?: string }).stderr;
        if (stderr && stderr.trim().length > 0) {
            return stderr.trim();
        }
    }

    if (error instanceof Error) {
        return error.message;
    }

    return "Unknown cargo fmt error";
}
