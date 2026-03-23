"use strict";

const shared = globalThis.__RUST_AUTOMOD_ZED_SHARED__ || require("./rautomod_zed_core");

function main() {
    const raw = process.env.RUST_AUTOMOD_ZED_INPUT;
    if (!raw) {
        fail("Rust AutoMod Zed bridge did not receive input.");
        return;
    }

    const input = JSON.parse(raw);
    const worktreeRoot = shared.path.resolve(String(input.worktreeRoot || process.cwd()));
    const args = Array.isArray(input.args) ? input.args.map(String) : [];

    let result;
    switch (String(input.command || "")) {
        case "rautomod-help":
            result = helpCommand();
            break;
        case "rautomod-scaffold":
            result = scaffoldCommand(worktreeRoot, args);
            break;
        case "rautomod-format":
            result = formatCommand(worktreeRoot, args);
            break;
        case "rautomod-audit":
            result = auditCommand(worktreeRoot, args);
            break;
        case "rautomod-explain":
            result = explainCommand(worktreeRoot, args);
            break;
        case "rautomod-create-pair":
            result = createPairCommand(worktreeRoot, args);
            break;
        default:
            throw new Error(`Unknown Rust AutoMod Zed command: ${String(input.command || "")}`);
    }

    respond(result);
}

function respond(result) {
    process.stdout.write(JSON.stringify({
        ok: true,
        title: result.title,
        body: result.body
    }));
}

function fail(message) {
    process.stdout.write(JSON.stringify({
        ok: false,
        error: String(message || "Rust AutoMod Zed bridge failed.")
    }));
}

function helpCommand() {
    return {
        title: "Rust AutoMod for Zed",
        body: [
            "Rust AutoMod for Zed is active.",
            "",
            "Visible editor features:",
            "- Open a .rautomod file to get syntax highlighting, diagnostics, hover help, formatting, and completions.",
            "- Use Format Document on .rautomod files to normalize spacing and lists.",
            "- When the Rust code-actions server is enabled in Zed settings, Rust files can offer module-registration and child-sync code actions.",
            "",
            "Assistant slash commands:",
            "- /rautomod-help",
            "- /rautomod-scaffold [relative-dir]",
            "- /rautomod-format <relative-path-to-.rautomod>",
            "- /rautomod-audit [relative-path-to-.rautomod]",
            "- /rautomod-explain <relative-path-to-rust-file>",
            "- /rautomod-create-pair <directory> <module> [visibility] [layout]",
            "",
            "Tip: add \"rustautomod-rust-actions\" to Languages > Rust > language_servers in Zed if you want the Rust code actions to appear alongside rust-analyzer."
        ].join("\n")
    };
}

function scaffoldCommand(worktreeRoot, args) {
    const relativeDir = args[0] || ".";
    const targetDir = shared.resolveInsideWorktree(worktreeRoot, relativeDir);
    shared.fs.mkdirSync(targetDir, { recursive: true });

    const targetPath = shared.path.join(targetDir, ".rautomod");
    const existed = shared.fs.existsSync(targetPath);
    if (!existed) {
        shared.fs.writeFileSync(targetPath, shared.starterConfig(), "utf8");
    }

    return {
        title: "Rust AutoMod Scaffold",
        body: [
            `Scaffold target: ${shared.toRelative(worktreeRoot, targetPath)}`,
            existed ? "Starter .rautomod already existed." : "Starter .rautomod created."
        ].join("\n")
    };
}

function formatCommand(worktreeRoot, args) {
    const relativePath = shared.requireArgument(args, "Expected the relative path to a .rautomod file.");
    const targetPath = shared.resolveInsideWorktree(worktreeRoot, relativePath);
    const content = shared.fs.readFileSync(targetPath, "utf8");
    const formatted = shared.formatRautomod(content);
    const changed = formatted !== content;

    if (changed) {
        shared.fs.writeFileSync(targetPath, formatted, "utf8");
    }

    return {
        title: "Rust AutoMod Format",
        body: [
            `File: ${shared.toRelative(worktreeRoot, targetPath)}`,
            changed ? "Formatting applied." : "No formatting changes were needed."
        ].join("\n")
    };
}

function auditCommand(worktreeRoot, args) {
    const relativePath = args[0] || ".rautomod";
    const targetPath = shared.resolveInsideWorktree(worktreeRoot, relativePath);
    const document = shared.resolveRautomodDocument(targetPath);
    const diagnostics = document.diagnostics || [];

    const lines = [
        `Config: ${shared.toRelative(worktreeRoot, targetPath)}`,
        `Schema: ${document.schemaVersion}`,
        `Strict: ${document.strictMode}`,
        `Extends: ${document.extendsPaths.length}`,
        `Rules: ${document.rules.length}`,
        `Diagnostics: ${diagnostics.length}`
    ];

    if (diagnostics.length > 0) {
        lines.push("");
        lines.push("Diagnostics:");
        diagnostics.forEach(diagnostic => {
            lines.push(`- line ${diagnostic.line + 1} [${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`);
        });
    } else {
        lines.push("");
        lines.push("No diagnostics found.");
    }

    return {
        title: "Rust AutoMod Audit",
        body: lines.join("\n")
    };
}

function explainCommand(worktreeRoot, args) {
    const relativePath = shared.requireArgument(args, "Expected the relative path to a Rust file.");
    const targetPath = shared.resolveInsideWorktree(worktreeRoot, relativePath);
    const resolved = shared.resolveProjectConfig(targetPath);

    const lines = [`Rust file: ${shared.toRelative(worktreeRoot, targetPath)}`];
    if (!resolved) {
        lines.push("No .rautomod matched this file. Default Rust AutoMod behavior would apply.");
        return {
            title: "Rust AutoMod Explain",
            body: lines.join("\n")
        };
    }

    lines.push(`Config source: ${resolved.sourcePath ? shared.toRelative(worktreeRoot, resolved.sourcePath) : "workspace defaults"}`);
    lines.push(`Matched rule: ${resolved.matchedRuleIndex >= 0 ? resolved.matchedRuleIndex + 1 : "default"}`);
    lines.push(`Strict mode: ${resolved.strictMode}`);
    lines.push(`Ignored: ${resolved.ignored ? "yes" : "no"}`);
    lines.push(`Reason: ${resolved.reason}`);
    if (resolved.matchedPatterns.length > 0) {
        lines.push(`Patterns: ${resolved.matchedPatterns.join(", ")}`);
    }
    lines.push("");
    lines.push("Resolved rule:");
    lines.push(`- visibility=${resolved.rule.visibility}`);
    lines.push(`- sort=${resolved.rule.sort}`);
    lines.push(`- fmt=${resolved.rule.fmt}`);
    lines.push(`- target=${resolved.rule.target}`);
    lines.push(`- blank_lines=${resolved.rule.blankLines}`);
    lines.push(`- reexport=${resolved.rule.reexport}`);

    return {
        title: "Rust AutoMod Explain",
        body: lines.join("\n")
    };
}

function createPairCommand(worktreeRoot, args) {
    if (args.length < 2) {
        throw new Error("Expected: <directory> <module> [visibility] [layout]");
    }

    const targetDir = shared.resolveInsideWorktree(worktreeRoot, args[0]);
    const moduleName = shared.sanitizeModuleName(args[1]);
    const visibility = shared.normalizeVisibility(args[2] || "pub");
    const requestedLayout = shared.normalizeLayout(args[3] || "auto");
    const layout = requestedLayout === "auto" ? shared.detectLayout(targetDir) : requestedLayout;

    shared.fs.mkdirSync(targetDir, { recursive: true });

    const createdPaths = [];
    if (layout === "modern") {
        const moduleFolder = shared.path.join(targetDir, moduleName);
        const moduleFile = shared.path.join(targetDir, `${moduleName}.rs`);
        shared.fs.mkdirSync(moduleFolder, { recursive: true });
        shared.writeIfMissing(moduleFile, "\n", createdPaths);
    } else {
        const moduleFolder = shared.path.join(targetDir, moduleName);
        const moduleFile = shared.path.join(moduleFolder, "mod.rs");
        shared.fs.mkdirSync(moduleFolder, { recursive: true });
        shared.writeIfMissing(moduleFile, "\n", createdPaths);
    }

    const registrationTarget = shared.resolveRegistrationTarget(targetDir, layout);
    shared.ensureDirectoryForFile(registrationTarget);
    if (!shared.fs.existsSync(registrationTarget)) {
        shared.fs.writeFileSync(registrationTarget, "", "utf8");
        createdPaths.push(registrationTarget);
    }

    const declaration = shared.declarationLine(moduleName, visibility);
    const registrationContent = shared.fs.readFileSync(registrationTarget, "utf8");
    if (!new RegExp(`(^|\\n)\\s*(pub\\([^\\n]+\\)\\s+|pub\\s+)?mod\\s+${shared.escapeRegExp(moduleName)}\\s*;`, "m").test(registrationContent)) {
        shared.fs.writeFileSync(registrationTarget, shared.appendDeclaration(registrationContent, declaration), "utf8");
    }

    return {
        title: "Rust AutoMod Create Pair",
        body: [
            `Directory: ${shared.toRelative(worktreeRoot, targetDir)}`,
            `Module: ${moduleName}`,
            `Layout: ${layout}`,
            `Visibility: ${visibility}`,
            `Registration target: ${shared.toRelative(worktreeRoot, registrationTarget)}`,
            createdPaths.length > 0
                ? `Created: ${createdPaths.map(filePath => shared.toRelative(worktreeRoot, filePath)).join(", ")}`
                : "Files already existed; only registration was ensured."
        ].join("\n")
    };
}

module.exports = {
    main
};

if (require.main === module) {
    try {
        main();
    } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
    }
}
