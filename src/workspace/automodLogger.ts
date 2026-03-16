import * as vscode from "vscode";

type LogLevel = "info" | "warn" | "error";

export class AutomodLogger implements vscode.Disposable {
    private readonly outputChannel = vscode.window.createOutputChannel("Rust AutoMod");

    log(level: LogLevel, event: string, details?: Record<string, unknown>): void {
        const timestamp = new Date().toISOString();
        const detailSuffix = details ? ` ${JSON.stringify(details)}` : "";
        this.outputChannel.appendLine(`[${timestamp}] [${level.toUpperCase()}] ${event}${detailSuffix}`);
    }

    info(event: string, details?: Record<string, unknown>): void {
        this.log("info", event, details);
    }

    warn(event: string, details?: Record<string, unknown>): void {
        this.log("warn", event, details);
    }

    error(event: string, details?: Record<string, unknown>): void {
        this.log("error", event, details);
    }

    show(preserveFocus = false): void {
        this.outputChannel.show(preserveFocus);
    }

    dispose(): void {
        this.outputChannel.dispose();
    }
}
