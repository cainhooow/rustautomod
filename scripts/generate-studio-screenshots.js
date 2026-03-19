const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { pathToFileURL } = require("url");

const repoRoot = path.resolve(__dirname, "..");
const mediaDir = path.join(repoRoot, "media");
const fontPath = path.join(repoRoot, "assets", "fonts", "varela-round.ttf");
const screenshotsDir = path.join(repoRoot, "assets", "screenshots");
const tempDir = path.join(screenshotsDir, ".temp");
const exampleWorkspace = process.env.RUSTAUTOMOD_STUDIO_WORKSPACE || "C:\\Users\\augus\\Projects\\pdv-server";
const edgePath = process.env.RUSTAUTOMOD_STUDIO_BROWSER || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const editorJs = fs.readFileSync(path.join(mediaDir, "rautomodEditorWebview.js"), "utf8");
const managerJs = fs.readFileSync(path.join(mediaDir, "rautomodManagerWebview.js"), "utf8");
const sharedCss = fs.readFileSync(path.join(mediaDir, "rautomodWebview.css"), "utf8");
const fontBase64 = fs.readFileSync(fontPath).toString("base64");

const sampleRelativePaths = [
    "src/application/queries/.rautomod",
    "src/application/usecases/.rautomod",
    "src/domain/builders/.rautomod",
    "src/domain/entities/.rautomod",
    "src/domain/repositories/.rautomod"
];

const managerState = {
    configs: sampleRelativePaths.map((relativePath, index) => {
        const folderPath = path.join(exampleWorkspace, path.dirname(relativePath));
        return {
            uri: `file:///${exampleWorkspace.replace(/\\/g, "/")}/${relativePath}`.replace(/ /g, "%20"),
            fileName: ".rautomod",
            workspaceName: "pdv-server",
            relativePath,
            folderUri: `file:///${folderPath.replace(/\\/g, "/")}`.replace(/ /g, "%20"),
            folderPath,
            ruleCount: index === 0 ? 2 : 1,
            diagnosticCount: index === 3 ? 1 : 0,
            strictMode: index === 3 ? "error" : "warn",
            schemaVersion: "1",
            extendsCount: index === 0 ? 1 : 0,
            targetModes: index % 3 === 0 ? ["auto", "lib.rs"] : ["auto"],
            impact: {
                totalRustFiles: 6,
                matchedCount: 4,
                ignoredCount: 1,
                shadowedCount: 0,
                uncoveredCount: 1,
                sampleItems: [
                    {
                        fileUri: `file:///${exampleWorkspace.replace(/\\/g, "/")}/src/application/queries/find_order.rs`,
                        folderUri: `file:///${exampleWorkspace.replace(/\\/g, "/")}/src/application/queries`,
                        relativePath: "find_order.rs",
                        status: "matched",
                        reason: "The file is covered by the winning rule in this .rautomod.",
                        winnerRuleIndex: 0,
                        matchedPatterns: ["queries/**"],
                        targetFilePath: path.join(exampleWorkspace, "src", "application", "queries", "mod.rs"),
                        targetFileUri: `file:///${exampleWorkspace.replace(/\\/g, "/")}/src/application/queries/mod.rs`,
                        previewLines: ["pub mod find_order;"]
                    },
                    {
                        fileUri: `file:///${exampleWorkspace.replace(/\\/g, "/")}/src/application/queries/generated_projection.rs`,
                        folderUri: `file:///${exampleWorkspace.replace(/\\/g, "/")}/src/application/queries`,
                        relativePath: "generated_projection.rs",
                        status: "ignored",
                        reason: "The winning rule matched, but exclude patterns marked the file as ignored.",
                        winnerRuleIndex: 1,
                        matchedPatterns: ["generated/**"],
                        previewLines: []
                    }
                ]
            },
            audit: {
                issueCount: index === 3 ? 2 : 1,
                invalidCount: index === 3 ? 1 : 0,
                duplicateRuleCount: 0,
                unusedRuleCount: 1,
                overlapCount: index === 0 ? 1 : 0,
                ignoredFileCount: 1,
                shadowedFileCount: 0,
                uncoveredFileCount: 1,
                topIssues: [
                    {
                        severity: index === 3 ? "error" : "warning",
                        kind: index === 3 ? "diagnostic" : "uncovered_file",
                        message: index === 3
                            ? "Line 3: strict accepts only 'off', 'warn', or 'error'"
                            : "find_order_cache.rs is not covered by any rule in this .rautomod."
                    }
                ]
            }
        };
    }),
    workspaceFolders: [
        {
            name: "pdv-server",
            uri: `file:///${exampleWorkspace.replace(/\\/g, "/")}`.replace(/ /g, "%20")
        }
    ],
    auditSummary: {
        invalidConfigs: 1,
        duplicateRules: 0,
        unusedRules: 4,
        overlaps: 1,
        ignoredFiles: 3,
        shadowedFiles: 0,
        uncoveredFiles: 2
    },
    moduleTree: [
        {
            workspaceName: "pdv-server",
            workspaceUri: `file:///${exampleWorkspace.replace(/\\/g, "/")}`.replace(/ /g, "%20"),
            roots: [
                {
                    id: "crate-lib",
                    name: "lib",
                    relativePath: "src/lib.rs",
                    sourceFileUri: `file:///${exampleWorkspace.replace(/\\/g, "/")}/src/lib.rs`,
                    sourceFilePath: path.join(exampleWorkspace, "src", "lib.rs"),
                    declarationFileUri: `file:///${exampleWorkspace.replace(/\\/g, "/")}/src/lib.rs`,
                    kind: "crate",
                    layout: "crate_root",
                    canCreateChild: true,
                    movableToCrateRoot: false,
                    childContainerUri: `file:///${exampleWorkspace.replace(/\\/g, "/")}/src`,
                    children: [
                        {
                            id: "module-application",
                            name: "application",
                            relativePath: "src/application.rs",
                            sourceFileUri: `file:///${exampleWorkspace.replace(/\\/g, "/")}/src/application.rs`,
                            sourceFilePath: path.join(exampleWorkspace, "src", "application.rs"),
                            declarationFileUri: `file:///${exampleWorkspace.replace(/\\/g, "/")}/src/lib.rs`,
                            visibility: "pub",
                            kind: "module",
                            layout: "modern",
                            canCreateChild: true,
                            movableToCrateRoot: false,
                            childContainerUri: `file:///${exampleWorkspace.replace(/\\/g, "/")}/src/application`,
                            children: [
                                {
                                    id: "module-queries",
                                    name: "queries",
                                    relativePath: "src/application/queries.rs",
                                    sourceFileUri: `file:///${exampleWorkspace.replace(/\\/g, "/")}/src/application/queries.rs`,
                                    sourceFilePath: path.join(exampleWorkspace, "src", "application", "queries.rs"),
                                    declarationFileUri: `file:///${exampleWorkspace.replace(/\\/g, "/")}/src/application.rs`,
                                    visibility: "pub(crate)",
                                    kind: "module",
                                    layout: "leaf",
                                    canCreateChild: false,
                                    movableToCrateRoot: true,
                                    children: []
                                },
                                {
                                    id: "module-services",
                                    name: "services",
                                    relativePath: "src/application/services.rs",
                                    sourceFileUri: `file:///${exampleWorkspace.replace(/\\/g, "/")}/src/application/services.rs`,
                                    sourceFilePath: path.join(exampleWorkspace, "src", "application", "services.rs"),
                                    declarationFileUri: `file:///${exampleWorkspace.replace(/\\/g, "/")}/src/application.rs`,
                                    visibility: "private",
                                    kind: "module",
                                    layout: "leaf",
                                    canCreateChild: false,
                                    movableToCrateRoot: true,
                                    children: []
                                }
                            ]
                        }
                    ]
                }
            ]
        }
    ]
};

const editorState = {
    uri: "file:///C:/Users/augus/Projects/pdv-server/src/application/queries/.rautomod",
    fileName: "C:\\Users\\augus\\Projects\\pdv-server\\src\\application\\queries\\.rautomod",
    workspaceName: "pdv-server",
    rawText: "fmt=enabled\nsort=alpha\n",
    schemaVersion: "1",
    strictMode: "warn",
    extendsPaths: "",
    rules: [
        {
            id: "rule-0-demo",
            visibility: "pub",
            sort: "alpha",
            fmt: "enabled",
            target: "auto",
            pattern: "",
            exclude: "",
            cfg: "",
            groupOrder: "use,cfg,pub_mod,mod,pub_use",
            blankLines: 1,
            reexport: "disabled",
            header: "",
            generatedComment: ""
        }
    ],
    diagnostics: []
};

const editorInsights = {
    impact: {
        totalRustFiles: 7,
        matchedCount: 5,
        ignoredCount: 1,
        shadowedCount: 0,
        uncoveredCount: 1,
        items: [
            {
                fileUri: `file:///${exampleWorkspace.replace(/\\/g, "/")}/src/application/queries/find_order.rs`,
                folderUri: `file:///${exampleWorkspace.replace(/\\/g, "/")}/src/application/queries`,
                relativePath: "find_order.rs",
                status: "matched",
                reason: "The file is covered by the winning rule in this .rautomod.",
                winnerRuleIndex: 0,
                matchedPatterns: ["queries/**"],
                targetFilePath: path.join(exampleWorkspace, "src", "application", "queries", "mod.rs"),
                targetFileUri: `file:///${exampleWorkspace.replace(/\\/g, "/")}/src/application/queries/mod.rs`,
                previewLines: ["pub mod find_order;"]
            },
            {
                fileUri: `file:///${exampleWorkspace.replace(/\\/g, "/")}/src/application/queries/generated_projection.rs`,
                folderUri: `file:///${exampleWorkspace.replace(/\\/g, "/")}/src/application/queries`,
                relativePath: "generated_projection.rs",
                status: "ignored",
                reason: "The winning rule matched, but exclude patterns marked the file as ignored.",
                winnerRuleIndex: 0,
                matchedPatterns: ["queries/**"],
                previewLines: []
            },
            {
                fileUri: `file:///${exampleWorkspace.replace(/\\/g, "/")}/src/application/queries/cache_snapshot.rs`,
                folderUri: `file:///${exampleWorkspace.replace(/\\/g, "/")}/src/application/queries`,
                relativePath: "cache_snapshot.rs",
                status: "uncovered",
                reason: "No rule in this .rautomod matched the file.",
                winnerRuleIndex: null,
                matchedPatterns: [],
                previewLines: []
            }
        ]
    },
    audit: {
        issueCount: 3,
        invalidCount: 0,
        duplicateRuleCount: 0,
        unusedRuleCount: 1,
        overlapCount: 1,
        ignoredFileCount: 1,
        shadowedFileCount: 0,
        uncoveredFileCount: 1,
        issues: [
            {
                severity: "warning",
                kind: "overlap",
                message: "find_order.rs matches multiple rules; the first one wins."
            },
            {
                severity: "info",
                kind: "ignored_file",
                message: "generated_projection.rs is ignored by exclude rules."
            },
            {
                severity: "warning",
                kind: "uncovered_file",
                message: "cache_snapshot.rs is not covered by any rule in this .rautomod."
            }
        ]
    },
    playground: {
        inputPath: "src/application/queries/find_order.rs",
        resolvedPath: path.join(exampleWorkspace, "src", "application", "queries", "find_order.rs"),
        outcome: "matched",
        reason: "The winning rule matches this path.",
        winnerRuleIndex: 0,
        matchedPatterns: ["queries/**"],
        targetFilePath: path.join(exampleWorkspace, "src", "application", "queries", "mod.rs"),
        previewLines: ["pub mod find_order;"],
        ruleDetails: [
            {
                ruleIndex: 0,
                matched: true,
                ignored: false,
                reason: "Matched pattern(s) queries/**.",
                matchedPatterns: ["queries/**"],
                summary: "pub / alpha / auto"
            }
        ]
    }
};

function ensureDir(directory) {
    fs.mkdirSync(directory, { recursive: true });
}

function escapeScriptContent(content) {
    return content.replace(/<\/script>/gi, "<\\/script>");
}

function createHtmlDocument({ title, bodyKind, css, bootstrapScript, appScript }) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
        @font-face {
            font-family: "Varela Round";
            src: url("data:font/ttf;base64,${fontBase64}") format("truetype");
            font-style: normal;
            font-weight: 400;
            font-display: swap;
        }
        ${css}
        body {
            overflow: hidden;
        }
    </style>
</head>
<body data-webview-kind="${bodyKind}">
    <div id="root"></div>
    <script>
        ${escapeScriptContent(bootstrapScript)}
    </script>
    <script>
        ${escapeScriptContent(appScript)}
    </script>
</body>
</html>`;
}

function createEditorBootstrap(mode) {
    return `
        const __codexState = { mode: "${mode}", openSections: ["document", "rules", "impact", "playground", "audit", "history"] };
        window.acquireVsCodeApi = function () {
            return {
                getState() {
                    return __codexState;
                },
                setState(nextState) {
                    Object.assign(__codexState, nextState || {});
                },
                postMessage(message) {
                    if (!message || message.type !== "ready") {
                        if (message && message.type === "refreshInsights") {
                            window.dispatchEvent(new MessageEvent("message", {
                                data: {
                                    type: "setInsights",
                                    value: ${JSON.stringify(editorInsights)}
                                }
                            }));
                        }
                        return;
                    }

                    window.__studioReady = true;
                    setTimeout(() => {
                        window.dispatchEvent(new MessageEvent("message", {
                            data: {
                                type: "setState",
                                value: ${JSON.stringify(editorState)}
                            }
                        }));

                        window.dispatchEvent(new MessageEvent("message", {
                            data: {
                                type: "setInsights",
                                value: ${JSON.stringify(editorInsights)}
                            }
                        }));

                        setTimeout(() => {
                            const tab = document.querySelector('[data-action="set-mode"][data-mode="${mode}"]');
                            if (tab) {
                                tab.click();
                            }
                        }, 60);
                    }, 30);
                }
            };
        };

        window.__notifyCaptureReady = function () {
            document.body.setAttribute("data-capture-ready", "true");
        };

        window.addEventListener("message", function (event) {
            if (event.data && event.data.type === "setState") {
                setTimeout(window.__notifyCaptureReady, 220);
            }
        });
    `;
}

function createManagerBootstrap() {
    return `
        const __codexState = { openCards: ["${managerState.configs[0].uri}"] };
        window.acquireVsCodeApi = function () {
            return {
                getState() {
                    return __codexState;
                },
                setState(nextState) {
                    Object.assign(__codexState, nextState || {});
                },
                postMessage(message) {
                    if (!message || message.type !== "ready") {
                        if (message && message.type === "runPlayground") {
                            window.dispatchEvent(new MessageEvent("message", {
                                data: {
                                    type: "setPlaygroundResult",
                                    uri: message.uri,
                                    value: {
                                        inputPath: message.inputPath,
                                        resolvedPath: message.inputPath,
                                        outcome: "matched",
                                        reason: "The winning rule matches this path.",
                                        winnerRuleIndex: 0,
                                        matchedPatterns: ["queries/**"],
                                        previewLines: ["pub mod find_order;"],
                                        ruleDetails: [
                                            {
                                                ruleIndex: 0,
                                                matched: true,
                                                ignored: false,
                                                reason: "Matched pattern(s) queries/**.",
                                                matchedPatterns: ["queries/**"],
                                                summary: "pub / alpha / auto"
                                            }
                                        ]
                                    }
                                }
                            }));
                        }
                        return;
                    }

                    setTimeout(() => {
                        window.dispatchEvent(new MessageEvent("message", {
                            data: {
                                type: "setState",
                                value: ${JSON.stringify(managerState)}
                            }
                        }));
                        setTimeout(() => {
                            document.body.setAttribute("data-capture-ready", "true");
                        }, 220);
                    }, 30);
                }
            };
        };
    `;
}

function writeHtml(fileName, html) {
    const filePath = path.join(tempDir, fileName);
    fs.writeFileSync(filePath, html, "utf8");
    return filePath;
}

function renderScreenshot(inputHtmlPath, outputPngPath, width, height) {
    if (!fs.existsSync(edgePath)) {
        throw new Error(`Browser not found for Studio screenshots: ${edgePath}`);
    }

    execFileSync(
        edgePath,
        [
            "--headless",
            "--disable-gpu",
            "--run-all-compositor-stages-before-draw",
            "--virtual-time-budget=4000",
            `--window-size=${width},${height}`,
            `--screenshot=${outputPngPath}`,
            pathToFileURL(inputHtmlPath).toString()
        ],
        {
            stdio: "ignore"
        }
    );
}

function main() {
    ensureDir(screenshotsDir);
    ensureDir(tempDir);

    const managerHtml = createHtmlDocument({
        title: "Rust AutoMod Manager",
        bodyKind: "manager",
        css: sharedCss,
        bootstrapScript: createManagerBootstrap(),
        appScript: managerJs
    });
    const visualHtml = createHtmlDocument({
        title: "Rust AutoMod Editor Visual",
        bodyKind: "editor",
        css: sharedCss,
        bootstrapScript: createEditorBootstrap("visual"),
        appScript: editorJs
    });
    const splitHtml = createHtmlDocument({
        title: "Rust AutoMod Editor Split",
        bodyKind: "editor",
        css: sharedCss,
        bootstrapScript: createEditorBootstrap("split"),
        appScript: editorJs
    });

    const managerHtmlPath = writeHtml("manager.html", managerHtml);
    const visualHtmlPath = writeHtml("editor-visual.html", visualHtml);
    const splitHtmlPath = writeHtml("editor-split.html", splitHtml);

    renderScreenshot(managerHtmlPath, path.join(screenshotsDir, "studio-manager-pdv-server.png"), 1600, 1420);
    renderScreenshot(visualHtmlPath, path.join(screenshotsDir, "studio-editor-visual-pdv-server.png"), 1600, 1400);
    renderScreenshot(splitHtmlPath, path.join(screenshotsDir, "studio-editor-split-pdv-server.png"), 1680, 1280);
}

main();
