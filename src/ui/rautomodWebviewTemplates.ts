import * as vscode from "vscode";
import * as path from "path";

export function getRautomodEditorHtml(
    webview: vscode.Webview,
    extensionUri: vscode.Uri
): string {
    return getHtmlDocument(webview, extensionUri, "editor");
}

export function getRautomodManagerHtml(
    webview: vscode.Webview,
    extensionUri: vscode.Uri
): string {
    return getHtmlDocument(webview, extensionUri, "manager");
}

function getHtmlDocument(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    kind: "editor" | "manager"
): string {
    const nonce = createNonce();
    const styleUri = toWebviewUri(webview, extensionUri, "media", "rautomodWebview.css");
    const fontUri = toWebviewUri(webview, extensionUri, "assets", "fonts", "varela-round.ttf");
    const scriptUri = toWebviewUri(
        webview,
        extensionUri,
        "media",
        kind === "editor" ? "rautomodEditorWebview.js" : "rautomodManagerWebview.js"
    );

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource} data:; script-src 'nonce-${nonce}' ${webview.cspSource};" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Rust AutoMod</title>
    <style>
        @font-face {
            font-family: "Varela Round";
            src: url("${fontUri}") format("truetype");
            font-style: normal;
            font-weight: 400;
            font-display: swap;
        }
    </style>
    <link rel="stylesheet" href="${styleUri}" />
</head>
<body data-webview-kind="${kind}">
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function toWebviewUri(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    ...segments: string[]
): string {
    return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...segments)).toString();
}

function createNonce(): string {
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let value = "";

    for (let index = 0; index < 32; index++) {
        value += characters.charAt(Math.floor(Math.random() * characters.length));
    }

    return value;
}
