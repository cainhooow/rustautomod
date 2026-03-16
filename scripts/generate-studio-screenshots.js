const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { pathToFileURL } = require("url");

const repoRoot = path.resolve(__dirname, "..");
const mediaDir = path.join(repoRoot, "media");
const fontPath = path.join(repoRoot, "assets", "fonts", "varela-round.ttf");
const screenshotsDir = path.join(repoRoot, "assets", "screenshots");
const tempDir = path.join(screenshotsDir, ".temp");
const exampleWorkspace = "C:\\Users\\augus\\Projects\\pdv-server";
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const editorJs = fs.readFileSync(path.join(mediaDir, "rautomodEditorWebview.js"), "utf8");
const managerJs = fs.readFileSync(path.join(mediaDir, "rautomodManagerWebview.js"), "utf8");
const sharedCss = fs.readFileSync(path.join(mediaDir, "rautomodWebview.css"), "utf8");
const fontBase64 = fs.readFileSync(fontPath).toString("base64");

const managerState = {
    configs: [
        "src/application/queries/.rautomod",
        "src/application/usecases/.rautomod",
        "src/domain/builders/.rautomod",
        "src/domain/entities/.rautomod",
        "src/domain/repositories/.rautomod",
        "src/infrastructure/interfaces/http/handlers/.rautomod",
        "src/infrastructure/interfaces/http/resources/.rautomod",
        "src/infrastructure/interfaces/http/routers/.rautomod",
        "src/infrastructure/mappers/.rautomod",
        "src/infrastructure/persistence/.rautomod"
    ].map(relativePath => ({
        uri: `file:///${exampleWorkspace.replace(/\\/g, "/")}/${relativePath}`.replace(/ /g, "%20"),
        fileName: ".rautomod",
        workspaceName: "pdv-server",
        relativePath,
        ruleCount: 1,
        diagnosticCount: 0,
        strictMode: "warn",
        schemaVersion: "1",
        extendsCount: 0
    })),
    workspaceFolders: [
        {
            name: "pdv-server",
            uri: `file:///${exampleWorkspace.replace(/\\/g, "/")}`.replace(/ /g, "%20")
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
        window.acquireVsCodeApi = function () {
            return {
                postMessage(message) {
                    if (!message || message.type !== "ready") {
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
        window.acquireVsCodeApi = function () {
            return {
                postMessage(message) {
                    if (!message || message.type !== "ready") {
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

    renderScreenshot(managerHtmlPath, path.join(screenshotsDir, "studio-manager-pdv-server.png"), 1600, 1180);
    renderScreenshot(visualHtmlPath, path.join(screenshotsDir, "studio-editor-visual-pdv-server.png"), 1600, 1400);
    renderScreenshot(splitHtmlPath, path.join(screenshotsDir, "studio-editor-split-pdv-server.png"), 1680, 1280);
}

main();
