(function () {
    const vscode = acquireVsCodeApi();
    const root = document.getElementById("root");

    let state = { configs: [], workspaceFolders: [] };
    let search = "";

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function renderRuntimeError(message) {
        root.innerHTML = `
            <div class="manager">
                <section class="panel">
                    <div class="eyebrow">Rust AutoMod Studio</div>
                    <h2>Manager failed to load</h2>
                    <div class="helper">${escapeHtml(message)}</div>
                </section>
            </div>
        `;
    }

    function renderConfigCard(config, index) {
        return `
            <article class="config-card">
                <header>
                    <div>
                        <h2>${escapeHtml(config.relativePath)}</h2>
                        <p>${escapeHtml(config.workspaceName || "No workspace folder")}</p>
                    </div>
                    <span class="badge">${config.diagnosticCount} diagnostics</span>
                </header>
                <div class="tag-row">
                    <span class="badge">${config.ruleCount} rules</span>
                    <span class="badge">strict=${escapeHtml(config.strictMode)}</span>
                    <span class="badge">schema=${escapeHtml(config.schemaVersion)}</span>
                    <span class="badge">${config.extendsCount} extends</span>
                </div>
                <div class="card-actions">
                    <button class="button primary" data-action="open-visual" data-index="${index}">Open Visual</button>
                    <button class="button ghost" data-action="open-raw" data-index="${index}">Open Raw</button>
                </div>
            </article>
        `;
    }

    function render() {
        const configs = (state.configs || []).filter(config => {
            const haystack = [config.relativePath, config.workspaceName, config.strictMode].join(" ").toLowerCase();
            return haystack.includes(search.toLowerCase());
        });

        const diagnostics = (state.configs || []).reduce((sum, config) => sum + Number(config.diagnosticCount || 0), 0);
        const rules = (state.configs || []).reduce((sum, config) => sum + Number(config.ruleCount || 0), 0);

        root.innerHTML = `
            <div class="manager">
                <section class="masthead">
                    <div class="eyebrow">Rust AutoMod Control Surface</div>
                    <h1>.rautomod Manager</h1>
                    <p>Browse every config in the workspace, jump into the visual editor, open raw files, scaffold new configs, and keep the extension feeling more like a product console than a loose collection of commands.</p>
                </section>
                <section class="summary-grid">
                    <div class="summary-card"><span class="helper">Configs</span><strong>${state.configs.length}</strong></div>
                    <div class="summary-card"><span class="helper">Rules</span><strong>${rules}</strong></div>
                    <div class="summary-card"><span class="helper">Diagnostics</span><strong>${diagnostics}</strong></div>
                    <div class="summary-card"><span class="helper">Workspaces</span><strong>${state.workspaceFolders.length}</strong></div>
                </section>
                <div class="manager-toolbar">
                    <div class="search"><input data-role="search" value="${escapeHtml(search)}" placeholder="Filter configs by path, workspace, or strict mode" /></div>
                    <button class="button secondary" data-action="open-manager-panel">Open Panel</button>
                    <button class="button ghost" data-action="refresh">Refresh</button>
                    <button class="button ghost" data-action="open-log">Open Log</button>
                </div>
                <section>
                    <div class="section-title">
                        <div>
                            <h2>Workspace Presets</h2>
                            <p>Create a starter .rautomod at the root of any workspace folder.</p>
                        </div>
                    </div>
                    <div class="workspace-list">
                        ${state.workspaceFolders.length > 0 ? state.workspaceFolders.map((folder, index) => `
                            <div class="config-card">
                                <header>
                                    <div>
                                        <h2>${escapeHtml(folder.name)}</h2>
                                        <p>${escapeHtml(folder.uri)}</p>
                                    </div>
                                    <span class="badge">Workspace</span>
                                </header>
                                <div class="card-actions">
                                    <button class="button secondary" data-action="scaffold" data-workspace-index="${index}">Scaffold .rautomod</button>
                                </div>
                            </div>
                        `).join("") : '<div class="empty-state">Open a workspace folder to manage .rautomod files here.</div>'}
                    </div>
                </section>
                <section>
                    <div class="section-title">
                        <div>
                            <h2>Configs</h2>
                            <p>The cards below are your .rautomod files, surfaced more like a settings UI than raw filesystem entries.</p>
                        </div>
                    </div>
                    <div class="config-list">
                        ${configs.length > 0 ? configs.map(renderConfigCard).join("") : '<div class="empty-state">No .rautomod matched your filter. Try scaffold on a workspace folder or clear the search.</div>'}
                    </div>
                </section>
            </div>
        `;
    }

    root.addEventListener("click", event => {
        const target = event.target.closest("[data-action]");
        if (!target) {
            return;
        }

        const action = target.getAttribute("data-action");
        const index = Number(target.getAttribute("data-index"));
        const workspaceIndex = Number(target.getAttribute("data-workspace-index"));

        switch (action) {
            case "refresh":
                vscode.postMessage({ type: "refresh" });
                return;
            case "open-manager-panel":
                vscode.postMessage({ type: "openManagerPanel" });
                return;
            case "open-log":
                vscode.postMessage({ type: "openLog" });
                return;
            case "open-visual":
                if (!Number.isNaN(index) && state.configs[index]) {
                    vscode.postMessage({ type: "openVisual", uri: state.configs[index].uri });
                }
                return;
            case "open-raw":
                if (!Number.isNaN(index) && state.configs[index]) {
                    vscode.postMessage({ type: "openRaw", uri: state.configs[index].uri });
                }
                return;
            case "scaffold":
                if (!Number.isNaN(workspaceIndex) && state.workspaceFolders[workspaceIndex]) {
                    vscode.postMessage({ type: "scaffold", uri: state.workspaceFolders[workspaceIndex].uri });
                }
                return;
        }
    });

    root.addEventListener("input", event => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement) || target.getAttribute("data-role") !== "search") {
            return;
        }

        search = target.value;
        render();
    });

    window.addEventListener("message", event => {
        const message = event.data;
        if (message.type === "setState") {
            state = message.value;
            render();
        }
    });

    window.addEventListener("error", event => {
        renderRuntimeError(event.message || "Unknown webview error.");
    });

    window.addEventListener("unhandledrejection", event => {
        const reason = event.reason && event.reason.message
            ? event.reason.message
            : String(event.reason || "Unknown promise rejection.");
        renderRuntimeError(reason);
    });

    root.innerHTML = '<div class="empty-state">Loading Rust AutoMod manager...</div>';
    vscode.postMessage({ type: "ready" });
})();
