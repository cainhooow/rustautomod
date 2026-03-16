(function () {
    const vscode = acquireVsCodeApi();
    const root = document.getElementById("root");
    const restored = vscode.getState() || {};

    let state = { configs: [], workspaceFolders: [], auditSummary: {} };
    let search = restored.search || "";
    let strictFilter = restored.strictFilter || "all";
    let targetFilter = restored.targetFilter || "all";
    let diagnosticsFilter = restored.diagnosticsFilter || "all";
    let openCards = new Set(restored.openCards || []);
    let playgroundInputs = restored.playgroundInputs || {};
    let playgroundResults = restored.playgroundResults || {};

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function persist() {
        vscode.setState({
            search,
            strictFilter,
            targetFilter,
            diagnosticsFilter,
            openCards: Array.from(openCards),
            playgroundInputs,
            playgroundResults
        });
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

    function renderLoading() {
        root.innerHTML = `
            <div class="manager">
                <section class="masthead studio-animated">
                    <div class="skeleton-block wide"></div>
                    <div class="skeleton-block medium"></div>
                </section>
                <section class="panel skeleton-panel">
                    <div class="skeleton-block wide"></div>
                    <div class="skeleton-block"></div>
                    <div class="skeleton-block"></div>
                </section>
            </div>
        `;
    }

    function setState(nextState) {
        state = nextState || { configs: [], workspaceFolders: [], auditSummary: {} };
        render();
    }

    function setPlaygroundResult(uri, result) {
        playgroundResults[uri] = result;
        persist();
        render();
    }

    function getFilteredConfigs() {
        return (state.configs || []).filter(config => {
            const haystack = [
                config.relativePath,
                config.workspaceName,
                config.strictMode,
                ...(config.targetModes || [])
            ].join(" ").toLowerCase();

            if (search && !haystack.includes(search.toLowerCase())) {
                return false;
            }
            if (strictFilter !== "all" && config.strictMode !== strictFilter) {
                return false;
            }
            if (targetFilter !== "all" && !(config.targetModes || []).includes(targetFilter)) {
                return false;
            }
            if (diagnosticsFilter === "with-diagnostics" && Number(config.diagnosticCount || 0) === 0) {
                return false;
            }
            if (diagnosticsFilter === "clean" && Number(config.diagnosticCount || 0) > 0) {
                return false;
            }

            return true;
        });
    }

    function renderSampleItem(config, item) {
        return `
            <div class="impact-item ${item.status}">
                <div class="impact-item-top">
                    <div>
                        <strong>${escapeHtml(item.relativePath)}</strong>
                        <div class="helper">${escapeHtml(item.reason)}</div>
                    </div>
                    <span class="badge badge-${item.status}">${escapeHtml(item.status)}</span>
                </div>
                <div class="hero-actions">
                    <button class="mini-button" data-action="open-file" data-uri="${escapeHtml(item.fileUri)}">Open File</button>
                    <button class="mini-button" data-action="reveal-folder" data-uri="${escapeHtml(item.folderUri)}">Reveal Folder</button>
                    ${item.targetFileUri ? `<button class="mini-button" data-action="open-file" data-uri="${escapeHtml(item.targetFileUri)}">Open Target</button>` : ""}
                </div>
            </div>
        `;
    }

    function renderAuditIssue(issue) {
        return `
            <div class="diagnostic-item ${issue.severity}">
                <strong>${escapeHtml(issue.kind.replace(/_/g, " "))}</strong>
                <div>${escapeHtml(issue.message)}</div>
                ${issue.fileUri ? `<button class="mini-button" data-action="open-file" data-uri="${escapeHtml(issue.fileUri)}">Open File</button>` : ""}
            </div>
        `;
    }

    function renderPlayground(config) {
        const input = playgroundInputs[config.uri] || "";
        const result = playgroundResults[config.uri];

        return `
            <div class="playground-bar">
                <input
                    data-role="manager-playground-input"
                    data-uri="${escapeHtml(config.uri)}"
                    value="${escapeHtml(input)}"
                    placeholder="src/application/queries/find_order.rs"
                />
                <button class="button secondary" data-action="run-playground" data-uri="${escapeHtml(config.uri)}">Why / Why Not</button>
            </div>
            ${result ? `
                <div class="playground-result ${result.outcome}">
                    <div class="impact-item-top">
                        <div>
                            <strong>${escapeHtml(result.outcome)}</strong>
                            <div class="helper">${escapeHtml(result.reason)}</div>
                        </div>
                        <span class="badge">${result.winnerRuleIndex === null ? "No winner" : "Rule " + (result.winnerRuleIndex + 1)}</span>
                    </div>
                    <div class="helper">${escapeHtml(result.resolvedPath)}</div>
                    ${(result.ruleDetails || []).slice(0, 5).map(rule => `
                        <div class="playground-rule ${rule.ruleIndex === result.winnerRuleIndex ? "winner" : ""}">
                            <div class="impact-item-top">
                                <strong>Rule ${rule.ruleIndex + 1}</strong>
                                <span class="badge ${rule.matched ? "badge-success" : "badge-muted"}">${rule.matched ? "matched" : "not matched"}</span>
                            </div>
                            <div class="helper">${escapeHtml(rule.summary)}</div>
                            <div>${escapeHtml(rule.reason)}</div>
                        </div>
                    `).join("")}
                </div>
            ` : `<div class="empty-state small">Use the playground to inspect why a path matches, gets ignored, or stays uncovered.</div>`}
        `;
    }

    function renderConfigCard(config, index) {
        const isOpen = openCards.has(config.uri);
        return `
            <details class="config-card studio-animated" data-role="config-card" data-uri="${escapeHtml(config.uri)}" ${isOpen ? "open" : ""}>
                <summary class="panel-summary">
                    <div>
                        <h2>${escapeHtml(config.relativePath)}</h2>
                        <p>${escapeHtml(config.workspaceName || "No workspace folder")}</p>
                    </div>
                    <div class="tag-row">
                        <span class="badge">${config.ruleCount} rules</span>
                        <span class="badge">strict=${escapeHtml(config.strictMode)}</span>
                        <span class="badge">${config.diagnosticCount} diagnostics</span>
                        <span class="badge">${(config.targetModes || []).join(", ") || "auto"}</span>
                    </div>
                </summary>
                <div class="disclosure-body">
                    <div class="card-actions">
                        <button class="button primary" data-action="open-visual" data-index="${index}">Open Visual</button>
                        <button class="button ghost" data-action="open-raw" data-index="${index}">Open Raw</button>
                        <button class="button ghost" data-action="reveal-folder" data-uri="${escapeHtml(config.folderUri)}">Open Folder</button>
                    </div>
                    <div class="summary-grid">
                        <div class="summary-card"><span class="helper">Matched</span><strong>${config.impact.matchedCount}</strong></div>
                        <div class="summary-card"><span class="helper">Ignored</span><strong>${config.impact.ignoredCount}</strong></div>
                        <div class="summary-card"><span class="helper">Shadowed</span><strong>${config.impact.shadowedCount}</strong></div>
                        <div class="summary-card"><span class="helper">Uncovered</span><strong>${config.impact.uncoveredCount}</strong></div>
                    </div>
                    <div class="field-grid">
                        <section class="panel">
                            <div class="panel-header">
                                <div>
                                    <h2>Impact</h2>
                                    <div class="helper">Example files affected by this config.</div>
                                </div>
                                <span class="badge">${config.impact.totalRustFiles} files</span>
                            </div>
                            <div class="impact-list">
                                ${(config.impact.sampleItems || []).length > 0
                                    ? config.impact.sampleItems.map(item => renderSampleItem(config, item)).join("")
                                    : `<div class="empty-state small">No sampled Rust files for this config yet.</div>`
                                }
                            </div>
                        </section>
                        <section class="panel">
                            <div class="panel-header">
                                <div>
                                    <h2>Audit</h2>
                                    <div class="helper">Top findings for this config subtree.</div>
                                </div>
                                <span class="badge">${config.audit.issueCount} issues</span>
                            </div>
                            <div class="diagnostic-list">
                                ${(config.audit.topIssues || []).length > 0
                                    ? config.audit.topIssues.map(renderAuditIssue).join("")
                                    : `<div class="empty-state small">No audit issues for this config.</div>`
                                }
                            </div>
                        </section>
                    </div>
                    <section class="panel">
                        <div class="panel-header">
                            <div>
                                <h2>Path Playground</h2>
                                <div class="helper">Run a quick why / why not check without opening the editor first.</div>
                            </div>
                        </div>
                        ${renderPlayground(config)}
                    </section>
                </div>
            </details>
        `;
    }

    function render() {
        const configs = getFilteredConfigs();
        const summary = state.auditSummary || {};
        const diagnostics = (state.configs || []).reduce((sum, config) => sum + Number(config.diagnosticCount || 0), 0);
        const rules = (state.configs || []).reduce((sum, config) => sum + Number(config.ruleCount || 0), 0);

        root.innerHTML = `
            <div class="manager">
                <section class="masthead studio-animated">
                    <div class="eyebrow">Rust AutoMod Control Surface</div>
                    <h1>.rautomod Manager</h1>
                    <p>Audit the whole workspace, filter configs by health and intent, and jump from overview to explanation without leaving the Studio.</p>
                </section>
                <section class="summary-grid">
                    <div class="summary-card"><span class="helper">Configs</span><strong>${state.configs.length}</strong></div>
                    <div class="summary-card"><span class="helper">Rules</span><strong>${rules}</strong></div>
                    <div class="summary-card"><span class="helper">Diagnostics</span><strong>${diagnostics}</strong></div>
                    <div class="summary-card"><span class="helper">Unused rules</span><strong>${summary.unusedRules || 0}</strong></div>
                    <div class="summary-card"><span class="helper">Overlaps</span><strong>${summary.overlaps || 0}</strong></div>
                    <div class="summary-card"><span class="helper">Uncovered</span><strong>${summary.uncoveredFiles || 0}</strong></div>
                </section>
                <div class="manager-toolbar">
                    <div class="search">
                        <input data-role="search" value="${escapeHtml(search)}" placeholder="Filter by path, workspace, strict mode, or target" />
                    </div>
                    <select data-role="strict-filter">
                        <option value="all" ${strictFilter === "all" ? "selected" : ""}>All strict modes</option>
                        <option value="off" ${strictFilter === "off" ? "selected" : ""}>strict=off</option>
                        <option value="warn" ${strictFilter === "warn" ? "selected" : ""}>strict=warn</option>
                        <option value="error" ${strictFilter === "error" ? "selected" : ""}>strict=error</option>
                    </select>
                    <select data-role="target-filter">
                        <option value="all" ${targetFilter === "all" ? "selected" : ""}>All targets</option>
                        <option value="auto" ${targetFilter === "auto" ? "selected" : ""}>auto</option>
                        <option value="mod.rs" ${targetFilter === "mod.rs" ? "selected" : ""}>mod.rs</option>
                        <option value="lib.rs" ${targetFilter === "lib.rs" ? "selected" : ""}>lib.rs</option>
                        <option value="main.rs" ${targetFilter === "main.rs" ? "selected" : ""}>main.rs</option>
                    </select>
                    <select data-role="diagnostics-filter">
                        <option value="all" ${diagnosticsFilter === "all" ? "selected" : ""}>All health</option>
                        <option value="with-diagnostics" ${diagnosticsFilter === "with-diagnostics" ? "selected" : ""}>With diagnostics</option>
                        <option value="clean" ${diagnosticsFilter === "clean" ? "selected" : ""}>Clean only</option>
                    </select>
                    <button class="button secondary" data-action="refresh">Refresh</button>
                    <button class="button ghost" data-action="open-log">Open Log</button>
                </div>
                <section class="panel">
                    <div class="panel-header">
                        <div>
                            <h2>Bulk Actions</h2>
                            <div class="helper">Scaffold or normalize multiple configs, regenerate modules, and jump straight to configs with diagnostics.</div>
                        </div>
                    </div>
                    <div class="card-actions">
                        <button class="button primary" data-action="scaffold-all">Scaffold All Roots</button>
                        <button class="button secondary" data-action="format-all">Format All .rautomod</button>
                        <button class="button ghost" data-action="regenerate-workspace">Regenerate Workspace</button>
                        <button class="button ghost" data-action="open-diagnostic-configs">Open Diagnostic Configs</button>
                        <button class="button ghost" data-action="open-manager-panel">Open Full Panel</button>
                    </div>
                </section>
                <section>
                    <div class="section-title">
                        <div>
                            <h2>Workspace Roots</h2>
                            <p>Scaffold a starter .rautomod at any root that still does not have one.</p>
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
                            <p>Filtered cards act like a settings UI: impact, audit, and why / why not checks stay one click away.</p>
                        </div>
                    </div>
                    <div class="config-list">
                        ${configs.length > 0 ? configs.map(renderConfigCard).join("") : '<div class="empty-state">No .rautomod matched your filters. Clear the filters or scaffold a workspace root.</div>'}
                    </div>
                </section>
            </div>
        `;
    }

    root.addEventListener("click", event => {
        if (!(event.target instanceof Element)) {
            return;
        }

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
            case "open-file":
                if (target.getAttribute("data-uri")) {
                    vscode.postMessage({ type: "openFile", uri: target.getAttribute("data-uri") });
                }
                return;
            case "reveal-folder":
                if (target.getAttribute("data-uri")) {
                    vscode.postMessage({ type: "revealFolder", uri: target.getAttribute("data-uri") });
                }
                return;
            case "scaffold":
                if (!Number.isNaN(workspaceIndex) && state.workspaceFolders[workspaceIndex]) {
                    vscode.postMessage({ type: "scaffold", uri: state.workspaceFolders[workspaceIndex].uri });
                }
                return;
            case "scaffold-all":
                vscode.postMessage({ type: "scaffoldAll" });
                return;
            case "format-all":
                vscode.postMessage({ type: "formatAll" });
                return;
            case "regenerate-workspace":
                vscode.postMessage({ type: "regenerateWorkspace" });
                return;
            case "open-diagnostic-configs":
                vscode.postMessage({ type: "openDiagnosticConfigs" });
                return;
            case "run-playground":
                if (target.getAttribute("data-uri")) {
                    vscode.postMessage({
                        type: "runPlayground",
                        uri: target.getAttribute("data-uri"),
                        inputPath: playgroundInputs[target.getAttribute("data-uri")] || ""
                    });
                }
                return;
        }
    });

    root.addEventListener("input", event => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
            return;
        }

        switch (target.getAttribute("data-role")) {
            case "search":
                search = target.value;
                persist();
                render();
                return;
            case "strict-filter":
                strictFilter = target.value;
                persist();
                render();
                return;
            case "target-filter":
                targetFilter = target.value;
                persist();
                render();
                return;
            case "diagnostics-filter":
                diagnosticsFilter = target.value;
                persist();
                render();
                return;
            case "manager-playground-input":
                playgroundInputs[target.getAttribute("data-uri")] = target.value;
                persist();
                return;
        }
    });

    root.addEventListener("toggle", event => {
        const target = event.target;
        if (!(target instanceof HTMLDetailsElement) || target.getAttribute("data-role") !== "config-card") {
            return;
        }

        const uri = target.getAttribute("data-uri");
        if (!uri) {
            return;
        }

        if (target.open) {
            openCards.add(uri);
        } else {
            openCards.delete(uri);
        }
        persist();
    }, true);

    window.addEventListener("message", event => {
        const message = event.data;
        if (message.type === "setState") {
            setState(message.value);
            return;
        }

        if (message.type === "setPlaygroundResult" && message.uri) {
            setPlaygroundResult(message.uri, message.value);
        }
    });

    window.addEventListener("error", event => {
        vscode.postMessage({
            type: "logWebviewError",
            context: "manager",
            message: event.message || "Unknown manager error."
        });
        renderRuntimeError(event.message || "Unknown manager error.");
    });

    window.addEventListener("unhandledrejection", event => {
        const reason = event.reason && event.reason.message
            ? event.reason.message
            : String(event.reason || "Unknown promise rejection.");
        vscode.postMessage({
            type: "logWebviewError",
            context: "manager-promise",
            message: reason
        });
        renderRuntimeError(reason);
    });

    renderLoading();
    vscode.postMessage({ type: "ready" });
})();
