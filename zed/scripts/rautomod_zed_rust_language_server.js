"use strict";

const shared = globalThis.__RUST_AUTOMOD_ZED_SHARED__ || require("./rautomod_zed_modules");

const documents = new Map();
let buffered = Buffer.alloc(0);
let shutdownRequested = false;

process.stdin.on("data", chunk => {
    buffered = Buffer.concat([buffered, chunk]);
    processBuffer();
});

process.stdin.on("end", () => {
    process.exit(shutdownRequested ? 0 : 1);
});

function processBuffer() {
    while (true) {
        const separatorIndex = buffered.indexOf("\r\n\r\n");
        if (separatorIndex === -1) {
            return;
        }

        const header = buffered.slice(0, separatorIndex).toString("utf8");
        const match = /Content-Length:\s*(\d+)/i.exec(header);
        if (!match) {
            buffered = Buffer.alloc(0);
            return;
        }

        const contentLength = Number(match[1]);
        const messageStart = separatorIndex + 4;
        if (buffered.length < messageStart + contentLength) {
            return;
        }

        const messageBuffer = buffered.slice(messageStart, messageStart + contentLength);
        buffered = buffered.slice(messageStart + contentLength);
        handleMessage(JSON.parse(messageBuffer.toString("utf8")));
    }
}

function handleMessage(message) {
    if (typeof message.id !== "undefined" && typeof message.method === "string") {
        handleRequest(message);
        return;
    }

    if (typeof message.method === "string") {
        handleNotification(message);
    }
}

function handleRequest(message) {
    switch (message.method) {
        case "initialize":
            sendResponse(message.id, {
                capabilities: {
                    textDocumentSync: {
                        openClose: true,
                        change: 1,
                        save: { includeText: true }
                    },
                    codeActionProvider: {
                        codeActionKinds: ["quickfix", shared.MODULE_CODE_ACTION_KIND]
                    }
                },
                serverInfo: {
                    name: "Rust AutoMod Rust Actions",
                    version: "0.3.1"
                }
            });
            return;
        case "textDocument/codeAction":
            sendResponse(message.id, codeActionResponse(message.params));
            return;
        case "shutdown":
            shutdownRequested = true;
            sendResponse(message.id, null);
            return;
        default:
            sendResponse(message.id, null);
            return;
    }
}

function handleNotification(message) {
    switch (message.method) {
        case "initialized":
            return;
        case "textDocument/didOpen":
            openDocument(message.params.textDocument);
            return;
        case "textDocument/didChange":
            changeDocument(message.params);
            return;
        case "textDocument/didSave":
            saveDocument(message.params);
            return;
        case "textDocument/didClose":
            closeDocument(message.params.textDocument);
            return;
        case "exit":
            process.exit(shutdownRequested ? 0 : 1);
            return;
        default:
            return;
    }
}

function openDocument(textDocument) {
    const filePath = shared.filePathFromUri(textDocument.uri);
    documents.set(filePath, {
        uri: textDocument.uri,
        filePath,
        version: textDocument.version || 0,
        text: textDocument.text || ""
    });
    publishDiagnostics(filePath);
}

function changeDocument(params) {
    const filePath = shared.filePathFromUri(params.textDocument.uri);
    const existing = documents.get(filePath);
    if (!existing) {
        return;
    }

    const latestChange = params.contentChanges[params.contentChanges.length - 1];
    existing.text = latestChange.text || "";
    existing.version = params.textDocument.version || existing.version;
    documents.set(filePath, existing);
    publishDiagnostics(filePath);
}

function saveDocument(params) {
    const filePath = shared.filePathFromUri(params.textDocument.uri);
    const existing = documents.get(filePath);
    if (!existing) {
        return;
    }

    if (typeof params.text === "string") {
        existing.text = params.text;
        documents.set(filePath, existing);
    }

    publishDiagnostics(filePath);
}

function closeDocument(textDocument) {
    const filePath = shared.filePathFromUri(textDocument.uri);
    documents.delete(filePath);
    sendNotification("textDocument/publishDiagnostics", {
        uri: textDocument.uri,
        diagnostics: []
    });
}

function publishDiagnostics(filePath) {
    const document = documents.get(filePath);
    if (!document) {
        return;
    }

    sendNotification("textDocument/publishDiagnostics", {
        uri: document.uri,
        diagnostics: shared.rustDiagnosticsForFile(filePath, documents)
    });
}

function codeActionResponse(params) {
    const filePath = shared.filePathFromUri(params.textDocument.uri);
    const codeActions = [];

    const registerPlan = shared.buildRegisterModulePlan(filePath, documents);
    if (registerPlan) {
        codeActions.push({
            title: registerPlan.title,
            kind: "quickfix",
            edit: shared.buildWorkspaceEdit(registerPlan)
        });
    }

    const syncPlan = shared.buildSyncChildModulesPlan(filePath, documents);
    if (syncPlan) {
        codeActions.push({
            title: syncPlan.title,
            kind: shared.MODULE_CODE_ACTION_KIND,
            edit: shared.buildWorkspaceEdit(syncPlan)
        });
    }

    return codeActions;
}

function sendResponse(id, result) {
    writeMessage({
        jsonrpc: "2.0",
        id,
        result
    });
}

function sendNotification(method, params) {
    writeMessage({
        jsonrpc: "2.0",
        method,
        params
    });
}

function writeMessage(payload) {
    const serialized = JSON.stringify(payload);
    const header = `Content-Length: ${Buffer.byteLength(serialized, "utf8")}\r\n\r\n`;
    process.stdout.write(header);
    process.stdout.write(serialized);
}
