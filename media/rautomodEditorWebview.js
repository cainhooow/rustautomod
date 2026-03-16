(function () {
    const vscode = acquireVsCodeApi();
    const root = document.getElementById("root");

    let state = null;
    let draft = null;
    let rawDraftText = "";
    let rawDirty = false;
    let mode = "visual";

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

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
            <div class="editor-shell">
                <section class="panel">
                    <div class="eyebrow">Rust AutoMod Studio</div>
                    <h2>Editor failed to load</h2>
                    <div class="helper">${escapeHtml(message)}</div>
                </section>
            </div>
        `;
    }

    function setState(nextState) {
        state = nextState;
        draft = clone(nextState);
        rawDraftText = nextState.rawText ?? "";
        rawDirty = false;
        render();
    }

    function renderPreservingViewport() {
        const viewportTop = window.scrollY;
        render();
        window.scrollTo(0, viewportTop);
    }

    function normalizeList(value) {
        return String(value || "")
            .split(",")
            .map(item => item.trim())
            .filter(Boolean)
            .join(",");
    }

    function normalizeDraftWhitespace(content) {
        const cleaned = content
            .replace(/\r\n/g, "\n")
            .split("\n")
            .map(line => line.trimEnd())
            .join("\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();

        return cleaned ? cleaned + "\n" : "";
    }

    function serializeDraftToText(documentDraft) {
        const lines = [
            "schema_version=" + (documentDraft.schemaVersion || "1"),
            "strict=" + (documentDraft.strictMode || "warn")
        ];

        if ((documentDraft.extendsPaths || "").trim()) {
            lines.push("extends=" + normalizeList(documentDraft.extendsPaths));
        }

        for (const rule of documentDraft.rules) {
            lines.push("");
            lines.push("visibility=" + (rule.visibility || "pub"));
            lines.push("sort=" + (rule.sort || "alpha"));
            lines.push("fmt=" + (rule.fmt || "disabled"));
            lines.push("target=" + (rule.target || "auto"));
            if ((rule.pattern || "").trim()) {
                lines.push("pattern=" + normalizeList(rule.pattern));
            }
            if ((rule.exclude || "").trim()) {
                lines.push("exclude=" + normalizeList(rule.exclude));
            }
            if ((rule.cfg || "").trim()) {
                lines.push("cfg=" + normalizeList(rule.cfg));
            }
            lines.push("group_order=" + normalizeList(rule.groupOrder || "use,cfg,pub_mod,mod,pub_use"));
            lines.push("blank_lines=" + String(rule.blankLines ?? 1));
            lines.push("reexport=" + (rule.reexport || "disabled"));
            if ((rule.header || "").trim()) {
                lines.push("header=" + rule.header.trim());
            }
            if ((rule.generatedComment || "").trim()) {
                lines.push("generated_comment=" + rule.generatedComment.trim());
            }
        }

        return normalizeDraftWhitespace(lines.join("\n"));
    }

    function renderSelectOptions(options, selectedValue) {
        return options.map(option => `<option value="${escapeHtml(option)}" ${option === selectedValue ? "selected" : ""}>${escapeHtml(option)}</option>`).join("");
    }

    function renderTab(tabMode, label) {
        return `<button class="tab ${mode === tabMode ? "active" : ""}" data-action="set-mode" data-mode="${tabMode}">${label}</button>`;
    }

    function renderDiagnostic(diagnostic) {
        return `
            <div class="diagnostic-item ${diagnostic.severity === "error" ? "error" : ""}">
                <strong>${diagnostic.severity.toUpperCase()}</strong>
                <div>Line ${Number(diagnostic.line) + 1}: ${escapeHtml(diagnostic.message)}</div>
                ${diagnostic.key ? `<div class="helper">Key: ${escapeHtml(diagnostic.key)}</div>` : ""}
            </div>
        `;
    }

    function renderRuleCard(rule, index) {
        const label = rule.pattern ? "Scoped rule" : "Default rule";
        return `
            <article class="rule-card">
                <div class="rule-head">
                    <div class="rule-title">
                        <h3>Rule ${index + 1}</h3>
                        <div class="rule-flags">
                            <span class="badge">${label}</span>
                            <span class="badge">${escapeHtml(rule.visibility)}</span>
                            <span class="badge">${escapeHtml(rule.target)}</span>
                        </div>
                    </div>
                    <div class="rule-actions">
                        <button class="button ghost" data-action="duplicate-rule" data-index="${index}">Duplicate</button>
                        <button class="button ghost" data-action="remove-rule" data-index="${index}">Remove</button>
                    </div>
                </div>
                <div class="field-grid compact">
                    <div class="field">
                        <label>Visibility</label>
                        <select data-scope="rule" data-index="${index}" data-field="visibility">
                            ${renderSelectOptions(["pub", "private", "pub(crate)", "pub(super)"], rule.visibility)}
                        </select>
                    </div>
                    <div class="field">
                        <label>Sort</label>
                        <select data-scope="rule" data-index="${index}" data-field="sort">
                            ${renderSelectOptions(["alpha", "alpha_case_insensitive", "none", "pub_first", "cfg_first"], rule.sort)}
                        </select>
                    </div>
                    <div class="field">
                        <label>Fmt</label>
                        <select data-scope="rule" data-index="${index}" data-field="fmt">
                            ${renderSelectOptions(["disabled", "enabled"], rule.fmt)}
                        </select>
                    </div>
                    <div class="field">
                        <label>Target</label>
                        <select data-scope="rule" data-index="${index}" data-field="target">
                            ${renderSelectOptions(["auto", "mod.rs", "lib.rs", "main.rs"], rule.target)}
                        </select>
                    </div>
                    <div class="field">
                        <label>Reexport</label>
                        <select data-scope="rule" data-index="${index}" data-field="reexport">
                            ${renderSelectOptions(["disabled", "enabled"], rule.reexport)}
                        </select>
                    </div>
                    <div class="field">
                        <label>Blank Lines</label>
                        <input type="number" min="0" data-scope="rule" data-index="${index}" data-field="blankLines" value="${escapeHtml(rule.blankLines)}" />
                    </div>
                </div>
                <div class="field-grid">
                    <div class="field">
                        <label>Pattern</label>
                        <input data-scope="rule" data-index="${index}" data-field="pattern" value="${escapeHtml(rule.pattern)}" placeholder="internal,!tests,src/api/**" />
                    </div>
                    <div class="field">
                        <label>Exclude</label>
                        <input data-scope="rule" data-index="${index}" data-field="exclude" value="${escapeHtml(rule.exclude)}" placeholder="generated/**,fixtures/**" />
                    </div>
                    <div class="field">
                        <label>Cfg</label>
                        <input data-scope="rule" data-index="${index}" data-field="cfg" value="${escapeHtml(rule.cfg)}" placeholder='feature="serde",all(unix, target_pointer_width = "64")' />
                    </div>
                    <div class="field">
                        <label>Group Order</label>
                        <input data-scope="rule" data-index="${index}" data-field="groupOrder" value="${escapeHtml(rule.groupOrder)}" placeholder="use,cfg,pub_mod,mod,pub_use" />
                    </div>
                    <div class="field">
                        <label>Header</label>
                        <input data-scope="rule" data-index="${index}" data-field="header" value="${escapeHtml(rule.header)}" placeholder="generated by rustautomod" />
                    </div>
                    <div class="field">
                        <label>Generated Comment</label>
                        <input data-scope="rule" data-index="${index}" data-field="generatedComment" value="${escapeHtml(rule.generatedComment)}" placeholder="managed by rustautomod" />
                    </div>
                </div>
            </article>
        `;
    }

    function renderVisualColumn(currentDraft, diagnostics) {
        const rulesMarkup = currentDraft.rules.length > 0
            ? currentDraft.rules.map((rule, index) => renderRuleCard(rule, index)).join("")
            : '<div class="empty-state">No rules yet. Add a rule block to start shaping this config visually.</div>';

        return `
            <div class="stack">
                <section class="panel">
                    <div class="panel-header">
                        <div>
                            <h2>Config Frame</h2>
                            <div class="helper">Visual edits rewrite the file in a normalized layout. Keep Raw mode nearby when you care about comments or exact spacing.</div>
                        </div>
                        <button class="button primary" data-action="apply-visual">Apply Visual Changes</button>
                    </div>
                    <div class="field-grid">
                        <div class="field">
                            <label>Schema Version</label>
                            <select data-scope="document" data-field="schemaVersion">
                                ${renderSelectOptions(["1"], currentDraft.schemaVersion)}
                            </select>
                        </div>
                        <div class="field">
                            <label>Strict Mode</label>
                            <select data-scope="document" data-field="strictMode">
                                ${renderSelectOptions(["off", "warn", "error"], currentDraft.strictMode)}
                            </select>
                        </div>
                        <div class="field" style="grid-column: span 2;">
                            <label>Extends</label>
                            <input data-scope="document" data-field="extendsPaths" value="${escapeHtml(currentDraft.extendsPaths)}" placeholder="./shared.rautomod,../preset.rautomod" />
                        </div>
                    </div>
                </section>
                <section class="panel">
                    <div class="panel-header">
                        <div>
                            <h2>Rule Blocks</h2>
                            <div class="helper">Each card is a block in the .rautomod file. Leave pattern empty to keep it as a default rule.</div>
                        </div>
                        <button class="button secondary" data-action="add-rule">Add Rule Block</button>
                    </div>
                    <div class="stack">${rulesMarkup}</div>
                </section>
            </div>
            <aside class="stack">
                <section class="panel">
                    <div class="panel-header">
                        <div>
                            <h2>Diagnostics</h2>
                            <div class="helper">Live parsing feedback from the extension.</div>
                        </div>
                        <span class="badge">${diagnostics.length} issues</span>
                    </div>
                    <div class="diagnostic-list">
                        ${diagnostics.length > 0 ? diagnostics.map(renderDiagnostic).join("") : '<div class="empty-state">No diagnostics right now. This config is clean.</div>'}
                    </div>
                </section>
                <section class="panel">
                    <div class="panel-header">
                        <div>
                            <h2>Context</h2>
                            <div class="helper">Useful file metadata while you edit visually.</div>
                        </div>
                    </div>
                    <div class="stack">
                        <div class="metric"><strong>File</strong><span class="helper">${escapeHtml(state.fileName)}</span></div>
                        <div class="metric"><strong>Workspace</strong><span class="helper">${escapeHtml(state.workspaceName || "No workspace folder")}</span></div>
                        <div class="metric"><strong>Raw mode</strong><span class="helper">${rawDirty ? "Has unsaved raw draft" : "Mirrors last applied content"}</span></div>
                    </div>
                </section>
            </aside>
        `;
    }

    function renderRawColumn() {
        return `
            <section class="panel raw-pane">
                <div class="panel-header">
                    <div>
                        <h2>Raw File</h2>
                        <div class="helper">Use this when you want full control. You can still bounce back to Visual mode after inspecting the text.</div>
                    </div>
                    <div class="hero-actions">
                        <button class="button ghost" data-action="format-raw">Format Raw</button>
                        <button class="button primary" data-action="apply-raw">Apply Raw Changes</button>
                    </div>
                </div>
                <div class="raw-banner">Visual mode will normalize the file and may remove comments or custom spacing. Raw mode is the safest place for hand-crafted notes.</div>
                <textarea data-role="raw-editor" spellcheck="false">${escapeHtml(rawDraftText)}</textarea>
            </section>
        `;
    }

    function render() {
        if (!state || !draft) {
            root.innerHTML = '<div class="empty-state">Loading Rust AutoMod editor...</div>';
            return;
        }

        const diagnostics = state.diagnostics ?? [];
        const layoutClass = mode === "raw" ? "raw" : mode === "split" ? "split" : "visual";
        const visualColumn = mode !== "raw" ? renderVisualColumn(draft, diagnostics) : "";
        const rawColumn = mode !== "visual" ? renderRawColumn() : "";

        root.innerHTML = `
            <div class="editor-shell">
                <section class="hero">
                    <div class="hero-top">
                        <div>
                            <div class="eyebrow">Rust AutoMod Studio</div>
                            <h1>.rautomod Visual Editor</h1>
                            <p>Shape rules visually, keep the raw file in reach, and treat the config like a first-class product surface instead of a loose text blob.</p>
                        </div>
                        <div class="hero-actions">
                            <span class="badge">${escapeHtml(state.workspaceName || "Workspace config")}</span>
                            <span class="badge">${diagnostics.length} diagnostics</span>
                            <span class="badge">${draft.rules.length} rule blocks</span>
                        </div>
                    </div>
                </section>
                <div class="toolbar">
                    <div class="tabs">
                        ${renderTab("visual", "Visual")}
                        ${renderTab("split", "Split")}
                        ${renderTab("raw", "Raw")}
                    </div>
                    <div class="hero-actions">
                        <button class="button ghost" data-action="reset">Reset Draft</button>
                        <button class="button secondary" data-action="add-rule">Add Rule</button>
                        <button class="button ghost" data-action="open-raw">Open Raw Externally</button>
                    </div>
                </div>
                <div class="content-grid ${layoutClass}">
                    ${visualColumn}
                    ${rawColumn}
                </div>
            </div>
        `;
    }

    function updateVisibleRawEditor() {
        const rawEditor = root.querySelector('[data-role="raw-editor"]');
        if (!(rawEditor instanceof HTMLTextAreaElement)) {
            return;
        }

        if (document.activeElement === rawEditor) {
            return;
        }

        if (rawEditor.value !== rawDraftText) {
            rawEditor.value = rawDraftText;
        }
    }

    function syncVisualToRaw() {
        if (!rawDirty) {
            rawDraftText = serializeDraftToText(draft);
            updateVisibleRawEditor();
        }
    }

    root.addEventListener("click", event => {
        const target = event.target.closest("[data-action]");
        if (!target || !draft) {
            return;
        }

        const action = target.getAttribute("data-action");
        const index = Number(target.getAttribute("data-index"));

        switch (action) {
            case "set-mode":
                mode = target.getAttribute("data-mode") || "visual";
                renderPreservingViewport();
                return;
            case "add-rule":
                draft.rules.push({
                    id: "rule-" + Date.now(),
                    visibility: "pub",
                    sort: "alpha",
                    fmt: "disabled",
                    target: "auto",
                    pattern: "",
                    exclude: "",
                    cfg: "",
                    groupOrder: "use,cfg,pub_mod,mod,pub_use",
                    blankLines: 1,
                    reexport: "disabled",
                    header: "",
                    generatedComment: ""
                });
                syncVisualToRaw();
                renderPreservingViewport();
                return;
            case "duplicate-rule":
                if (!Number.isNaN(index) && draft.rules[index]) {
                    draft.rules.splice(index + 1, 0, Object.assign({}, clone(draft.rules[index]), { id: "rule-" + Date.now() }));
                    syncVisualToRaw();
                    renderPreservingViewport();
                }
                return;
            case "remove-rule":
                if (!Number.isNaN(index)) {
                    draft.rules.splice(index, 1);
                    syncVisualToRaw();
                    renderPreservingViewport();
                }
                return;
            case "apply-visual":
                vscode.postMessage({ type: "applyVisual", value: draft });
                return;
            case "apply-raw":
                vscode.postMessage({ type: "applyRaw", rawText: rawDraftText });
                return;
            case "format-raw":
                vscode.postMessage({ type: "formatRaw", rawText: rawDraftText });
                return;
            case "open-raw":
                vscode.postMessage({ type: "openRaw" });
                return;
            case "reset":
                draft = clone(state);
                rawDraftText = state.rawText ?? "";
                rawDirty = false;
                renderPreservingViewport();
                return;
        }
    });

    root.addEventListener("input", event => {
        const target = event.target;
        if (!draft || !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
            return;
        }

        const role = target.getAttribute("data-role");
        if (role === "raw-editor") {
            rawDraftText = target.value;
            rawDirty = true;
            return;
        }

        const scope = target.getAttribute("data-scope");
        const field = target.getAttribute("data-field");
        const index = Number(target.getAttribute("data-index"));
        if (!scope || !field) {
            return;
        }

        if (scope === "document") {
            draft[field] = target.value;
            syncVisualToRaw();
            return;
        }

        if (scope === "rule" && !Number.isNaN(index) && draft.rules[index]) {
            draft.rules[index][field] = field === "blankLines"
                ? Math.max(0, Number(target.value) || 0)
                : target.value;
            syncVisualToRaw();
        }
    });

    root.addEventListener("change", event => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
            return;
        }

        if (target.getAttribute("data-role") === "raw-editor") {
            return;
        }

        if (target.hasAttribute("data-scope") && target.hasAttribute("data-field")) {
            renderPreservingViewport();
        }
    });

    window.addEventListener("message", event => {
        const message = event.data;
        switch (message.type) {
            case "setState":
                setState(message.value);
                break;
            case "formattedRaw":
                rawDraftText = message.rawText ?? "";
                rawDirty = true;
                renderPreservingViewport();
                break;
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

    root.innerHTML = '<div class="empty-state">Loading Rust AutoMod editor...</div>';
    vscode.postMessage({ type: "ready" });
})();
