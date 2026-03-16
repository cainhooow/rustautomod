import * as vscode from "vscode";

const RAUTOMOD_DOCUMENT_SELECTOR: vscode.DocumentSelector = [{ language: "rautomod" }, { pattern: "**/.rautomod" }];

const KEYWORDS: Record<string, string> = {
    visibility: "Set module visibility",
    sort: "Set sorting order for generated declarations",
    fmt: "Run cargo fmt after Rust AutoMod changes",
    target: "Choose the registration target file",
    pattern: "Apply a rule only to matching files or folders",
    exclude: "Ignore matching files or folders",
    cfg: "Attach cfg attributes to generated declarations",
    group_order: "Choose the managed declaration group order",
    blank_lines: "Set blank lines between managed groups",
    reexport: "Generate pub use self::<module>::* lines",
    header: "Add a generated header comment",
    generated_comment: "Mark the generated declaration block",
    strict: "Choose validation strictness for the config file",
    schema_version: "Pin the config schema version",
    extends: "Inherit rules from another .rautomod file"
};

export const completionProvider = vscode.languages.registerCompletionItemProvider(
    RAUTOMOD_DOCUMENT_SELECTOR,
    {
        provideCompletionItems(document, position) {
            const linePrefix = document.lineAt(position).text.substring(0, position.character);
            const trimmedPrefix = linePrefix.trim();
            const completions: vscode.CompletionItem[] = [];

            for (const [keyword, detail] of Object.entries(KEYWORDS)) {
                if (keyword.startsWith(trimmedPrefix)) {
                    const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
                    item.detail = detail;
                    completions.push(item);
                }
            }

            if (/^visibility\s*=/.test(linePrefix)) {
                completions.push(...createValueItems(["pub", "private", "pub(crate)", "pub(super)"]));
            }

            if (/^sort\s*=/.test(linePrefix)) {
                completions.push(...createValueItems(["alpha", "alpha_case_insensitive", "none", "pub_first", "cfg_first"]));
            }

            if (/^fmt\s*=/.test(linePrefix)) {
                completions.push(...createValueItems(["enabled", "disabled"]));
            }

            if (/^target\s*=/.test(linePrefix)) {
                completions.push(...createValueItems(["auto", "mod.rs", "lib.rs", "main.rs"]));
            }

            if (/^pattern\s*=/.test(linePrefix) || /^exclude\s*=/.test(linePrefix)) {
                completions.push(...createValueItems(["src/internal/**", "!tests", "generated/**", "utils,helpers"]));
            }

            if (/^cfg\s*=/.test(linePrefix)) {
                completions.push(...createValueItems([
                    "windows,unix",
                    "feature=\"serde\"",
                    "all(unix, target_pointer_width = \"64\")"
                ]));
            }

            if (/^group_order\s*=/.test(linePrefix)) {
                completions.push(...createValueItems(["use,cfg,pub_mod,mod,pub_use", "cfg,pub_mod,mod,pub_use,use"]));
            }

            if (/^blank_lines\s*=/.test(linePrefix)) {
                completions.push(...createValueItems(["0", "1", "2"]));
            }

            if (/^reexport\s*=/.test(linePrefix)) {
                completions.push(...createValueItems(["enabled", "disabled"]));
            }

            if (/^strict\s*=/.test(linePrefix)) {
                completions.push(...createValueItems(["off", "warn", "error"]));
            }

            if (/^schema_version\s*=/.test(linePrefix)) {
                completions.push(...createValueItems(["1"]));
            }

            if (/^extends\s*=/.test(linePrefix)) {
                completions.push(...createValueItems(["./shared.rautomod", "../.rautomod.base"]));
            }

            return completions;
        }
    }
);

function createValueItems(values: string[]): vscode.CompletionItem[] {
    return values.map(value => new vscode.CompletionItem(value, vscode.CompletionItemKind.Value));
}
