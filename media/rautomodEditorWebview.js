(function () {
    const vscode = acquireVsCodeApi();
    const root = document.getElementById("root");
    const restoredState = vscode.getState() || {};

    const VALID_VISIBILITY = ["pub", "private", "pub(crate)", "pub(super)"];
    const VALID_SORT = ["alpha", "alpha_case_insensitive", "none", "pub_first", "cfg_first"];
    const VALID_FMT = ["disabled", "enabled"];
    const VALID_TARGET = ["auto", "mod.rs", "lib.rs", "main.rs"];
    const VALID_REEXPORT = ["disabled", "enabled"];
    const VALID_STRICT = ["off", "warn", "error"];
    const VALID_GROUP_ORDER = ["use", "cfg", "pub_mod", "mod", "pub_use"];

    let state = null;
    let insights = null;
    let draft = null;
    let rawDraftText = "";
    let rawEditedManually = false;
    let mode = restoredState.mode || "visual";
    let playgroundInput = restoredState.playgroundInput || "";
    let historyByUri = restoredState.historyByUri || {};
    let openSections = new Set(restoredState.openSections || ["document", "rules", "impact", "playground", "audit", "history"]);
    let draggingRuleId = null;
    let acceptIncomingState = false;
    let renderTimer = null;
    let insightsTimer = null;

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function uid(prefix) {
        return prefix + "-" + Math.random().toString(36).slice(2, 10);
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function escapeAttr(value) {
        return escapeHtml(value);
    }

    function encodeDataValue(value) {
        return encodeURIComponent(String(value ?? ""));
    }

    function decodeDataValue(value) {
        try {
            return decodeURIComponent(String(value ?? ""));
        } catch {
            return String(value ?? "");
        }
    }

    function persistUiState() {
        vscode.setState({
            mode,
            playgroundInput,
            historyByUri,
            openSections: Array.from(openSections)
        });
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

    function renderLoadingSkeleton() {
        root.innerHTML = `
            <div class="editor-shell">
                <section class="hero studio-animated">
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

    function ensureRuleIds(documentState) {
        const nextState = clone(documentState);
        nextState.rules = (nextState.rules || []).map(rule => Object.assign({}, rule, {
            id: rule.id || uid("rule")
        }));
        return nextState;
    }

    function createRule() {
        return {
            id: uid("rule"),
            visibility: "pub",
            sort: "alpha",
            fmt: "disabled",
            target: "auto",
            pattern: "",
            exclude: "",
            cfg: "",
            groupOrder: VALID_GROUP_ORDER.join(","),
            blankLines: 1,
            reexport: "disabled",
            header: "",
            generatedComment: ""
        };
    }

    function createEmptyInsights() {
        return {
            impact: {
                totalRustFiles: 0,
                matchedCount: 0,
                ignoredCount: 0,
                shadowedCount: 0,
                uncoveredCount: 0,
                items: []
            },
            audit: {
                issueCount: 0,
                invalidCount: 0,
                duplicateRuleCount: 0,
                unusedRuleCount: 0,
                overlapCount: 0,
                ignoredFileCount: 0,
                shadowedFileCount: 0,
                uncoveredFileCount: 0,
                issues: []
            },
            playground: null
        };
    }

    function splitChipList(value) {
        const input = String(value ?? "").trim();
        if (!input) {
            return [];
        }

        const entries = [];
        let current = "";
        let depth = 0;
        let inQuotes = false;

        for (let index = 0; index < input.length; index += 1) {
            const character = input[index];
            if (character === '"' && input[index - 1] !== "\\") {
                inQuotes = !inQuotes;
                current += character;
                continue;
            }

            if (!inQuotes) {
                if (character === "(" || character === "[" || character === "{") {
                    depth += 1;
                } else if (character === ")" || character === "]" || character === "}") {
                    depth = Math.max(0, depth - 1);
                } else if (character === "," && depth === 0) {
                    if (current.trim()) {
                        entries.push(current.trim());
                    }
                    current = "";
                    continue;
                }
            }

            current += character;
        }

        if (current.trim()) {
            entries.push(current.trim());
        }

        return entries;
    }

    function joinChipList(values) {
        return values.filter(Boolean).join(",");
    }

    function normalizeDraftWhitespace(content) {
        const cleaned = String(content ?? "")
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

        const extendsEntries = splitChipList(documentDraft.extendsPaths);
        if (extendsEntries.length > 0) {
            lines.push("extends=" + joinChipList(extendsEntries));
        }

        for (const rule of documentDraft.rules || []) {
            lines.push("");
            lines.push("visibility=" + (rule.visibility || "pub"));
            lines.push("sort=" + (rule.sort || "alpha"));
            lines.push("fmt=" + (rule.fmt || "disabled"));
            lines.push("target=" + (rule.target || "auto"));

            const patternEntries = splitChipList(rule.pattern);
            const excludeEntries = splitChipList(rule.exclude);
            const cfgEntries = splitChipList(rule.cfg);
            const groupEntries = splitChipList(rule.groupOrder || VALID_GROUP_ORDER.join(","));

            if (patternEntries.length > 0) {
                lines.push("pattern=" + joinChipList(patternEntries));
            }
            if (excludeEntries.length > 0) {
                lines.push("exclude=" + joinChipList(excludeEntries));
            }
            if (cfgEntries.length > 0) {
                lines.push("cfg=" + joinChipList(cfgEntries));
            }

            lines.push("group_order=" + joinChipList(groupEntries.length > 0 ? groupEntries : VALID_GROUP_ORDER));
            lines.push("blank_lines=" + String(Math.max(0, Number(rule.blankLines) || 0)));
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

    function getHistoryEntries() {
        if (!state?.uri) {
            return [];
        }

        return historyByUri[state.uri] || [];
    }

    function pushHistorySnapshot(label, documentDraft, rawText) {
        if (!state?.uri) {
            return;
        }

        const snapshotRawText = normalizeDraftWhitespace(rawText);
        const entries = getHistoryEntries();
        if (entries[0] && entries[0].rawText === snapshotRawText) {
            return;
        }

        historyByUri[state.uri] = [
            {
                id: uid("snapshot"),
                label,
                timestamp: Date.now(),
                rawText: snapshotRawText,
                draft: ensureRuleIds(documentDraft)
            },
            ...entries
        ].slice(0, 12);
        persistUiState();
    }

    function getSavedSerializedText() {
        return state ? serializeDraftToText(state) : "";
    }

    function getVisualSerializedText() {
        return draft ? serializeDraftToText(draft) : "";
    }

    function hasVisualChanges() {
        return Boolean(state && draft && getVisualSerializedText() !== getSavedSerializedText());
    }

    function hasRawChanges() {
        return Boolean(state && normalizeDraftWhitespace(rawDraftText) !== normalizeDraftWhitespace(state.rawText || ""));
    }

    function hasDivergedDrafts() {
        return Boolean(rawEditedManually && hasVisualChanges() && normalizeDraftWhitespace(rawDraftText) !== getVisualSerializedText());
    }

    function hasUnsavedChanges() {
        return hasVisualChanges() || hasRawChanges();
    }

    function getWorkingText() {
        if (mode === "raw" && rawEditedManually) {
            return normalizeDraftWhitespace(rawDraftText);
        }

        if (hasDivergedDrafts()) {
            return getVisualSerializedText();
        }

        if (rawEditedManually) {
            return normalizeDraftWhitespace(rawDraftText);
        }

        return getVisualSerializedText() || normalizeDraftWhitespace(rawDraftText);
    }

    function requestInsightsRefresh() {
        if (!state) {
            return;
        }

        if (insightsTimer) {
            clearTimeout(insightsTimer);
        }

        insightsTimer = setTimeout(() => {
            vscode.postMessage({
                type: "refreshInsights",
                rawText: getWorkingText(),
                matchPath: playgroundInput.trim() || undefined
            });
        }, 220);
    }

    function captureInteractionState() {
        const activeElement = document.activeElement;
        return {
            viewportTop: window.scrollY,
            focusId: activeElement && root.contains(activeElement)
                ? activeElement.getAttribute("data-focus-id")
                : null,
            selectionStart: typeof activeElement?.selectionStart === "number" ? activeElement.selectionStart : null,
            selectionEnd: typeof activeElement?.selectionEnd === "number" ? activeElement.selectionEnd : null,
            elementScrollTop: typeof activeElement?.scrollTop === "number" ? activeElement.scrollTop : null
        };
    }

    function restoreInteractionState(snapshot) {
        window.scrollTo(0, snapshot.viewportTop || 0);
        if (!snapshot.focusId) {
            return;
        }

        const nextElement = root.querySelector('[data-focus-id="' + snapshot.focusId + '"]');
        if (!nextElement || typeof nextElement.focus !== "function") {
            return;
        }

        nextElement.focus({ preventScroll: true });

        if (typeof snapshot.selectionStart === "number" && typeof nextElement.selectionStart === "number") {
            nextElement.selectionStart = snapshot.selectionStart;
            nextElement.selectionEnd = snapshot.selectionEnd;
        }

        if (typeof snapshot.elementScrollTop === "number" && typeof nextElement.scrollTop === "number") {
            nextElement.scrollTop = snapshot.elementScrollTop;
        }
    }

    function scheduleRender() {
        if (renderTimer) {
            return;
        }

        renderTimer = requestAnimationFrame(() => {
            renderTimer = null;
            const interaction = captureInteractionState();
            render();
            restoreInteractionState(interaction);
        });
    }

    function setState(nextState) {
        const incomingState = ensureRuleIds(nextState);

        if (state && hasUnsavedChanges() && !acceptIncomingState) {
            const shouldReplace = window.confirm("The underlying .rautomod changed. Replace your unsaved Studio draft with the latest saved version?");
            if (!shouldReplace) {
                return;
            }

            pushHistorySnapshot("Discarded draft", draft, rawDraftText);
        } else if (state && normalizeDraftWhitespace(state.rawText || "") !== normalizeDraftWhitespace(incomingState.rawText || "")) {
            pushHistorySnapshot("Saved version", state, state.rawText || "");
        }

        state = incomingState;
        draft = clone(incomingState);
        rawDraftText = incomingState.rawText || "";
        rawEditedManually = false;
        insights = insights || createEmptyInsights();
        acceptIncomingState = false;
        persistUiState();
        scheduleRender();
        requestInsightsRefresh();
    }

    function setInsights(nextInsights) {
        insights = nextInsights || createEmptyInsights();
        scheduleRender();
    }

    function setMode(nextMode) {
        if (mode === nextMode) {
            return;
        }

        mode = nextMode;
        persistUiState();
        requestInsightsRefresh();
        scheduleRender();
    }

    function setOpenSection(sectionId, isOpen) {
        if (isOpen) {
            openSections.add(sectionId);
        } else {
            openSections.delete(sectionId);
        }
        persistUiState();
    }

    function syncVisualToRaw() {
        if (rawEditedManually) {
            return;
        }

        rawDraftText = getVisualSerializedText();
    }

    function updateDocumentField(field, value) {
        if (!draft) {
            return;
        }

        draft[field] = value;
        syncVisualToRaw();
        requestInsightsRefresh();
        scheduleRender();
    }

    function updateRuleField(index, field, value) {
        if (!draft?.rules[index]) {
            return;
        }

        draft.rules[index][field] = field === "blankLines"
            ? Math.max(0, Number(value) || 0)
            : value;
        syncVisualToRaw();
        requestInsightsRefresh();
        scheduleRender();
    }

    function applyFieldFix(scope, index, field, value) {
        if (scope === "document") {
            updateDocumentField(field, value);
            return;
        }

        updateRuleField(index, field, value);
    }

    function getDocumentFieldIssues(documentDraft) {
        const issues = {
            schemaVersion: [],
            strictMode: [],
            extendsPaths: []
        };

        if (!["1"].includes(String(documentDraft.schemaVersion || ""))) {
            issues.schemaVersion.push({
                severity: "error",
                message: "schema_version only supports 1 right now.",
                fixValue: "1"
            });
        }

        if (!VALID_STRICT.includes(String(documentDraft.strictMode || ""))) {
            issues.strictMode.push({
                severity: "error",
                message: "strict should be off, warn, or error.",
                fixValue: "warn"
            });
        }

        const duplicateExtends = findDuplicateTokens(splitChipList(documentDraft.extendsPaths));
        if (duplicateExtends.length > 0) {
            issues.extendsPaths.push({
                severity: "warning",
                message: "Repeated extends entries can make the config harder to read."
            });
        }

        return issues;
    }

    function getRuleFieldIssues(rule) {
        const issues = {
            visibility: [],
            sort: [],
            fmt: [],
            target: [],
            pattern: [],
            exclude: [],
            cfg: [],
            groupOrder: [],
            blankLines: [],
            reexport: [],
            header: [],
            generatedComment: []
        };

        if (!VALID_VISIBILITY.includes(String(rule.visibility || ""))) {
            issues.visibility.push({
                severity: "error",
                message: "visibility must be one of the supported Rust AutoMod values.",
                fixValue: "pub"
            });
        }

        if (!VALID_SORT.includes(String(rule.sort || ""))) {
            issues.sort.push({
                severity: "error",
                message: "sort must be alpha, alpha_case_insensitive, none, pub_first, or cfg_first.",
                fixValue: "alpha"
            });
        }

        if (!VALID_FMT.includes(String(rule.fmt || ""))) {
            issues.fmt.push({
                severity: "error",
                message: "fmt should be enabled or disabled.",
                fixValue: "disabled"
            });
        }

        if (!VALID_TARGET.includes(String(rule.target || ""))) {
            issues.target.push({
                severity: "error",
                message: "target should be auto, mod.rs, lib.rs, or main.rs.",
                fixValue: "auto"
            });
        }

        if (!VALID_REEXPORT.includes(String(rule.reexport || ""))) {
            issues.reexport.push({
                severity: "error",
                message: "reexport should be enabled or disabled.",
                fixValue: "disabled"
            });
        }

        const blankLines = Number(rule.blankLines);
        if (!Number.isInteger(blankLines) || blankLines < 0) {
            issues.blankLines.push({
                severity: "error",
                message: "blank_lines must be a non-negative integer.",
                fixValue: "1"
            });
        }

        const groupOrderEntries = splitChipList(rule.groupOrder || "");
        const invalidGroups = groupOrderEntries.filter(entry => !VALID_GROUP_ORDER.includes(entry));
        if (invalidGroups.length > 0 || groupOrderEntries.length !== VALID_GROUP_ORDER.length) {
            issues.groupOrder.push({
                severity: "warning",
                message: "group_order should contain each supported group exactly once.",
                fixValue: VALID_GROUP_ORDER.join(",")
            });
        }

        const patternEntries = splitChipList(rule.pattern || "");
        if (patternEntries.length > 0 && patternEntries.every(entry => entry.startsWith("!"))) {
            issues.pattern.push({
                severity: "warning",
                message: "A rule with only negative patterns can never win."
            });
        }

        if (findDuplicateTokens(patternEntries).length > 0) {
            issues.pattern.push({
                severity: "info",
                message: "Repeated pattern entries can be simplified."
            });
        }

        if (findDuplicateTokens(splitChipList(rule.exclude || "")).length > 0) {
            issues.exclude.push({
                severity: "info",
                message: "Repeated exclude entries can be simplified."
            });
        }

        if (findDuplicateTokens(splitChipList(rule.cfg || "")).length > 0) {
            issues.cfg.push({
                severity: "info",
                message: "Repeated cfg entries can be simplified."
            });
        }

        return issues;
    }

    function findDuplicateTokens(values) {
        const duplicates = [];
        const seen = new Set();
        for (const value of values) {
            if (seen.has(value)) {
                duplicates.push(value);
            }
            seen.add(value);
        }
        return duplicates;
    }

    function applyRecommendedDocumentFixes() {
        const issues = getDocumentFieldIssues(draft);
        Object.entries(issues).forEach(([field, fieldIssues]) => {
            const quickFix = fieldIssues.find(issue => issue.fixValue !== undefined);
            if (quickFix) {
                draft[field] = quickFix.fixValue;
            }
        });
        syncVisualToRaw();
        requestInsightsRefresh();
        scheduleRender();
    }

    function applyRecommendedRuleFixes(index) {
        const rule = draft?.rules[index];
        if (!rule) {
            return;
        }

        const issues = getRuleFieldIssues(rule);
        Object.entries(issues).forEach(([field, fieldIssues]) => {
            const quickFix = fieldIssues.find(issue => issue.fixValue !== undefined);
            if (quickFix) {
                rule[field] = field === "blankLines"
                    ? Math.max(0, Number(quickFix.fixValue) || 0)
                    : quickFix.fixValue;
            }
        });
        syncVisualToRaw();
        requestInsightsRefresh();
        scheduleRender();
    }

    function updateChipField(scope, index, field, values) {
        const normalized = joinChipList(values);
        if (scope === "document") {
            updateDocumentField(field, normalized);
            return;
        }

        updateRuleField(index, field, normalized);
    }

    function commitChipInput(target) {
        const scope = target.getAttribute("data-chip-scope");
        const field = target.getAttribute("data-chip-field");
        const index = Number(target.getAttribute("data-index"));
        const nextValues = splitChipList(target.value);

        if (!scope || !field || nextValues.length === 0) {
            target.value = "";
            return;
        }

        const baseValues = scope === "document"
            ? splitChipList(draft[field] || "")
            : splitChipList(draft.rules[index]?.[field] || "");

        updateChipField(scope, index, field, [...baseValues, ...nextValues]);
        target.value = "";
    }

    function focusIdForDocumentField(field) {
        return "document:" + field;
    }

    function focusIdForRuleField(ruleId, field) {
        return "rule:" + ruleId + ":" + field;
    }

    function focusIdForChip(scope, id, field) {
        return "chip:" + scope + ":" + id + ":" + field;
    }

    function renderSelectOptions(options, selectedValue) {
        return options.map(option => `
            <option value="${escapeAttr(option)}" ${option === selectedValue ? "selected" : ""}>${escapeHtml(option)}</option>
        `).join("");
    }

    function renderInlineIssues(scope, index, field, issues) {
        if (!issues || issues.length === 0) {
            return "";
        }

        return `
            <div class="inline-issue-list">
                ${issues.map(issue => `
                    <div class="inline-issue ${issue.severity}">
                        <span>${escapeHtml(issue.message)}</span>
                        ${issue.fixValue !== undefined ? `
                            <button
                                class="mini-button"
                                data-action="apply-fix"
                                data-scope="${scope}"
                                data-index="${index}"
                                data-field="${field}"
                                data-value="${escapeAttr(encodeDataValue(issue.fixValue))}"
                            >
                                Fix
                            </button>
                        ` : ""}
                    </div>
                `).join("")}
            </div>
        `;
    }

    function renderChipEditor(options) {
        const values = splitChipList(options.value || "");
        const scope = options.scope;
        const index = options.index;
        const focusId = focusIdForChip(scope, options.focusKey, options.field);

        return `
            <div class="field">
                <label>${escapeHtml(options.label)}</label>
                <div class="chip-editor">
                    <div class="chip-list">
                        ${values.length > 0 ? values.map(value => `
                            <span class="chip">
                                <span>${escapeHtml(value)}</span>
                                <button
                                    class="chip-remove"
                                    data-action="remove-chip"
                                    data-chip-scope="${scope}"
                                    data-index="${index}"
                                    data-chip-field="${options.field}"
                                    data-chip-value="${escapeAttr(encodeDataValue(value))}"
                                >
                                    x
                                </button>
                            </span>
                        `).join("") : `<span class="helper">${escapeHtml(options.emptyLabel || "No entries yet.")}</span>`}
                    </div>
                    <div class="chip-input-row">
                        <input
                            data-focus-id="${focusId}"
                            data-role="chip-input"
                            data-chip-scope="${scope}"
                            data-index="${index}"
                            data-chip-field="${options.field}"
                            placeholder="${escapeAttr(options.placeholder)}"
                        />
                        <button
                            class="mini-button"
                            data-action="add-chip"
                            data-chip-scope="${scope}"
                            data-index="${index}"
                            data-chip-field="${options.field}"
                            data-focus-id="${focusId}:add"
                        >
                            Add
                        </button>
                    </div>
                </div>
                ${renderInlineIssues(scope, index, options.field, options.issues)}
            </div>
        `;
    }

    function renderField(options) {
        return `
            <div class="field">
                <label>${escapeHtml(options.label)}</label>
                ${options.control}
                ${renderInlineIssues(options.scope, options.index, options.field, options.issues)}
            </div>
        `;
    }

    function renderDisclosure(sectionId, title, subtitle, body, badgeMarkup) {
        return `
            <details class="panel studio-animated" data-disclosure-id="${sectionId}" ${openSections.has(sectionId) ? "open" : ""}>
                <summary class="panel-summary">
                    <div>
                        <h2>${escapeHtml(title)}</h2>
                        <div class="helper">${escapeHtml(subtitle)}</div>
                    </div>
                    <div class="hero-actions">
                        ${badgeMarkup || ""}
                    </div>
                </summary>
                <div class="disclosure-body">
                    ${body}
                </div>
            </details>
        `;
    }

    function renderRuleCard(rule, index) {
        const issues = getRuleFieldIssues(rule);
        const issueCount = Object.values(issues).reduce((count, fieldIssues) => count + fieldIssues.length, 0);
        const label = splitChipList(rule.pattern || "").length > 0 ? "Scoped rule" : "Default rule";
        const focusKey = rule.id || ("rule-" + index);

        return `
            <article class="rule-card studio-animated" draggable="true" data-rule-index="${index}" data-rule-id="${escapeAttr(rule.id)}">
                <div class="rule-card-banner">
                    <button class="drag-handle" data-role="drag-handle" title="Drag to reorder">::</button>
                    <div class="rule-title">
                        <h3>Rule ${index + 1}</h3>
                        <div class="helper">${label}. First matching rule still wins.</div>
                    </div>
                    <div class="rule-flags">
                        <span class="badge">${escapeHtml(rule.visibility)}</span>
                        <span class="badge">${escapeHtml(rule.target)}</span>
                        <span class="badge">${issueCount} fixes</span>
                    </div>
                </div>
                <div class="rule-actions">
                    <button class="button ghost" data-action="duplicate-rule" data-index="${index}">Duplicate</button>
                    <button class="button ghost" data-action="move-rule-up" data-index="${index}">Move Up</button>
                    <button class="button ghost" data-action="move-rule-down" data-index="${index}">Move Down</button>
                    <button class="button ghost" data-action="fix-rule" data-index="${index}">Quick Fix</button>
                    <button class="button ghost" data-action="remove-rule" data-index="${index}">Remove</button>
                </div>
                <div class="field-grid compact">
                    ${renderField({
                        scope: "rule",
                        index,
                        field: "visibility",
                        label: "Visibility",
                        issues: issues.visibility,
                        control: `
                            <select data-focus-id="${focusIdForRuleField(focusKey, "visibility")}" data-scope="rule" data-index="${index}" data-field="visibility">
                                ${renderSelectOptions(VALID_VISIBILITY, rule.visibility)}
                            </select>
                        `
                    })}
                    ${renderField({
                        scope: "rule",
                        index,
                        field: "sort",
                        label: "Sort",
                        issues: issues.sort,
                        control: `
                            <select data-focus-id="${focusIdForRuleField(focusKey, "sort")}" data-scope="rule" data-index="${index}" data-field="sort">
                                ${renderSelectOptions(VALID_SORT, rule.sort)}
                            </select>
                        `
                    })}
                    ${renderField({
                        scope: "rule",
                        index,
                        field: "fmt",
                        label: "Fmt",
                        issues: issues.fmt,
                        control: `
                            <select data-focus-id="${focusIdForRuleField(focusKey, "fmt")}" data-scope="rule" data-index="${index}" data-field="fmt">
                                ${renderSelectOptions(VALID_FMT, rule.fmt)}
                            </select>
                        `
                    })}
                    ${renderField({
                        scope: "rule",
                        index,
                        field: "target",
                        label: "Target",
                        issues: issues.target,
                        control: `
                            <select data-focus-id="${focusIdForRuleField(focusKey, "target")}" data-scope="rule" data-index="${index}" data-field="target">
                                ${renderSelectOptions(VALID_TARGET, rule.target)}
                            </select>
                        `
                    })}
                </div>
                <div class="field-grid">
                    ${renderChipEditor({
                        label: "Pattern",
                        scope: "rule",
                        index,
                        field: "pattern",
                        value: rule.pattern,
                        placeholder: "internal,!tests,src/api/**",
                        emptyLabel: "No pattern means this rule acts like a default fallback.",
                        issues: issues.pattern,
                        focusKey
                    })}
                    ${renderChipEditor({
                        label: "Exclude",
                        scope: "rule",
                        index,
                        field: "exclude",
                        value: rule.exclude,
                        placeholder: "generated/**,fixtures/**",
                        emptyLabel: "Exclude wins after the rule matches.",
                        issues: issues.exclude,
                        focusKey
                    })}
                    ${renderChipEditor({
                        label: "Cfg",
                        scope: "rule",
                        index,
                        field: "cfg",
                        value: rule.cfg,
                        placeholder: 'feature="serde",all(unix, target_pointer_width = "64")',
                        emptyLabel: "Add cfg wrappers when declarations need feature gates.",
                        issues: issues.cfg,
                        focusKey
                    })}
                </div>
                <details class="advanced-section" data-disclosure-id="rule-advanced-${escapeAttr(rule.id)}" ${openSections.has("rule-advanced-" + rule.id) ? "open" : ""}>
                    <summary>Advanced Rule Options</summary>
                    <div class="field-grid">
                        ${renderField({
                            scope: "rule",
                            index,
                            field: "groupOrder",
                            label: "Group Order",
                            issues: issues.groupOrder,
                            control: `
                                <input
                                    data-focus-id="${focusIdForRuleField(focusKey, "groupOrder")}"
                                    data-scope="rule"
                                    data-index="${index}"
                                    data-field="groupOrder"
                                    value="${escapeAttr(rule.groupOrder)}"
                                    placeholder="use,cfg,pub_mod,mod,pub_use"
                                />
                            `
                        })}
                        ${renderField({
                            scope: "rule",
                            index,
                            field: "blankLines",
                            label: "Blank Lines",
                            issues: issues.blankLines,
                            control: `
                                <input
                                    type="number"
                                    min="0"
                                    data-focus-id="${focusIdForRuleField(focusKey, "blankLines")}"
                                    data-scope="rule"
                                    data-index="${index}"
                                    data-field="blankLines"
                                    value="${escapeAttr(rule.blankLines)}"
                                />
                            `
                        })}
                        ${renderField({
                            scope: "rule",
                            index,
                            field: "reexport",
                            label: "Reexport",
                            issues: issues.reexport,
                            control: `
                                <select data-focus-id="${focusIdForRuleField(focusKey, "reexport")}" data-scope="rule" data-index="${index}" data-field="reexport">
                                    ${renderSelectOptions(VALID_REEXPORT, rule.reexport)}
                                </select>
                            `
                        })}
                        ${renderField({
                            scope: "rule",
                            index,
                            field: "header",
                            label: "Header",
                            issues: issues.header,
                            control: `
                                <input
                                    data-focus-id="${focusIdForRuleField(focusKey, "header")}"
                                    data-scope="rule"
                                    data-index="${index}"
                                    data-field="header"
                                    value="${escapeAttr(rule.header)}"
                                    placeholder="generated by rustautomod"
                                />
                            `
                        })}
                        ${renderField({
                            scope: "rule",
                            index,
                            field: "generatedComment",
                            label: "Generated Comment",
                            issues: issues.generatedComment,
                            control: `
                                <input
                                    data-focus-id="${focusIdForRuleField(focusKey, "generatedComment")}"
                                    data-scope="rule"
                                    data-index="${index}"
                                    data-field="generatedComment"
                                    value="${escapeAttr(rule.generatedComment)}"
                                    placeholder="managed by rustautomod"
                                />
                            `
                        })}
                    </div>
                </details>
            </article>
        `;
    }

    function renderImpactItem(item) {
        const preview = (item.previewLines || []).length > 0
            ? `<pre class="code-preview">${escapeHtml(item.previewLines.join("\n"))}</pre>`
            : `<div class="helper">No preview lines for this item.</div>`;

        const targetActions = [];
        if (item.fileUri) {
            targetActions.push(`<button class="mini-button" data-action="open-file" data-uri="${escapeAttr(item.fileUri)}">Open Source</button>`);
        }
        if (item.targetFileUri) {
            targetActions.push(`<button class="mini-button" data-action="open-file" data-uri="${escapeAttr(item.targetFileUri)}">Open Target</button>`);
        }
        if (item.folderUri) {
            targetActions.push(`<button class="mini-button" data-action="reveal-folder" data-uri="${escapeAttr(item.folderUri)}">Reveal Folder</button>`);
        }

        return `
            <article class="impact-item ${item.status}">
                <div class="impact-item-top">
                    <div>
                        <strong>${escapeHtml(item.relativePath)}</strong>
                        <div class="helper">${escapeHtml(item.reason)}</div>
                    </div>
                    <div class="hero-actions">
                        <span class="badge badge-${item.status}">${escapeHtml(item.status)}</span>
                        <span class="badge">rule ${item.winnerRuleIndex === null ? "-" : item.winnerRuleIndex + 1}</span>
                    </div>
                </div>
                <div class="helper">
                    ${item.matchedPatterns && item.matchedPatterns.length > 0 ? "Matched patterns: " + escapeHtml(item.matchedPatterns.join(", ")) : "No explicit pattern match recorded."}
                </div>
                ${item.targetFilePath ? `<div class="helper">Target: ${escapeHtml(item.targetFilePath)}</div>` : ""}
                ${item.shadowedByConfigUri ? `<div class="helper">Shadowed by: ${escapeHtml(item.shadowedByConfigUri)}</div>` : ""}
                ${preview}
                <div class="hero-actions">${targetActions.join("")}</div>
            </article>
        `;
    }

    function renderAuditIssue(issue) {
        return `
            <div class="diagnostic-item ${issue.severity}">
                <strong>${escapeHtml(issue.kind.replace(/_/g, " "))}</strong>
                <div>${escapeHtml(issue.message)}</div>
                ${issue.fileUri ? `<button class="mini-button" data-action="open-file" data-uri="${escapeAttr(issue.fileUri)}">Open File</button>` : ""}
            </div>
        `;
    }

    function renderHistoryItem(entry, index) {
        return `
            <article class="history-item">
                <div>
                    <strong>${escapeHtml(entry.label)}</strong>
                    <div class="helper">${new Date(entry.timestamp).toLocaleString()}</div>
                </div>
                <div class="hero-actions">
                    <span class="badge">${(entry.draft?.rules || []).length} rules</span>
                    <button class="mini-button" data-action="restore-history" data-history-index="${index}">Restore Draft</button>
                </div>
            </article>
        `;
    }

    function renderPlayground(playground) {
        const resultMarkup = playground ? `
            <div class="playground-result ${playground.outcome}">
                <div class="impact-item-top">
                    <div>
                        <strong>${escapeHtml(playground.outcome)}</strong>
                        <div class="helper">${escapeHtml(playground.reason)}</div>
                    </div>
                    <div class="hero-actions">
                        <span class="badge">${playground.winnerRuleIndex === null ? "No winner" : "Rule " + (playground.winnerRuleIndex + 1)}</span>
                    </div>
                </div>
                <div class="helper">${escapeHtml(playground.resolvedPath)}</div>
                ${playground.targetFilePath ? `<div class="helper">Target: ${escapeHtml(playground.targetFilePath)}</div>` : ""}
                ${(playground.previewLines || []).length > 0 ? `<pre class="code-preview">${escapeHtml(playground.previewLines.join("\n"))}</pre>` : ""}
                <div class="playground-rule-list">
                    ${(playground.ruleDetails || []).map(rule => `
                        <div class="playground-rule ${rule.ruleIndex === playground.winnerRuleIndex ? "winner" : ""}">
                            <div class="impact-item-top">
                                <strong>Rule ${rule.ruleIndex + 1}</strong>
                                <span class="badge ${rule.matched ? "badge-success" : "badge-muted"}">${rule.matched ? "matched" : "not matched"}</span>
                            </div>
                            <div class="helper">${escapeHtml(rule.summary)}</div>
                            <div>${escapeHtml(rule.reason)}</div>
                        </div>
                    `).join("")}
                </div>
            </div>
        ` : `<div class="empty-state small">Type a Rust path or module and run the playground to see which rule wins and why.</div>`;

        return `
            <div class="playground-bar">
                <input
                    data-focus-id="playground-input"
                    data-role="playground-input"
                    value="${escapeAttr(playgroundInput)}"
                    placeholder="src/application/queries/find_order.rs"
                />
                <button class="button secondary" data-action="run-playground">Analyze Path</button>
            </div>
            ${resultMarkup}
        `;
    }

    function renderVisualColumn() {
        const documentIssues = getDocumentFieldIssues(draft);
        const impact = insights?.impact || createEmptyInsights().impact;
        const audit = insights?.audit || createEmptyInsights().audit;
        const historyEntries = getHistoryEntries();

        return `
            <div class="stack">
                ${renderDisclosure(
                    "document",
                    "Config Frame",
                    "Document-wide settings, quick fixes, and preservable metadata.",
                    `
                        <div class="panel-toolbar">
                            <button class="button primary" data-action="apply-visual">Apply Visual Changes</button>
                            <button class="button ghost" data-action="fix-document">Quick Fix Document</button>
                            <button class="button ghost" data-action="snapshot">Create Snapshot</button>
                        </div>
                        <div class="field-grid">
                            ${renderField({
                                scope: "document",
                                index: "",
                                field: "schemaVersion",
                                label: "Schema Version",
                                issues: documentIssues.schemaVersion,
                                control: `
                                    <select data-focus-id="${focusIdForDocumentField("schemaVersion")}" data-scope="document" data-field="schemaVersion">
                                        ${renderSelectOptions(["1"], draft.schemaVersion)}
                                    </select>
                                `
                            })}
                            ${renderField({
                                scope: "document",
                                index: "",
                                field: "strictMode",
                                label: "Strict Mode",
                                issues: documentIssues.strictMode,
                                control: `
                                    <select data-focus-id="${focusIdForDocumentField("strictMode")}" data-scope="document" data-field="strictMode">
                                        ${renderSelectOptions(VALID_STRICT, draft.strictMode)}
                                    </select>
                                `
                            })}
                            ${renderChipEditor({
                                label: "Extends",
                                scope: "document",
                                index: "",
                                field: "extendsPaths",
                                value: draft.extendsPaths,
                                placeholder: "./shared.rautomod,../preset.rautomod",
                                emptyLabel: "No inherited preset files yet.",
                                issues: documentIssues.extendsPaths,
                                focusKey: "document"
                            })}
                        </div>
                        <div class="raw-banner">
                            Visual save preserves unmanaged comment blocks and unrecognized sections from the last raw source whenever possible.
                        </div>
                    `,
                    `<span class="badge">${draft.rules.length} rules</span>`
                )}
                ${renderDisclosure(
                    "rules",
                    "Rule Blocks",
                    "Reorder with drag and drop, keep common fields visible, and tuck advanced options away.",
                    `
                        <div class="panel-toolbar">
                            <button class="button secondary" data-action="add-rule">Add Rule Block</button>
                        </div>
                        <div class="stack">
                            ${draft.rules.length > 0
                                ? draft.rules.map((rule, index) => renderRuleCard(rule, index)).join("")
                                : `<div class="empty-state">No rules yet. Add a rule block to start shaping this config visually.</div>`
                            }
                        </div>
                    `,
                    `<span class="badge">${draft.rules.length} total</span>`
                )}
                ${renderDisclosure(
                    "impact",
                    "Impact Preview",
                    "See which Rust files are matched, ignored, shadowed, or still uncovered by this .rautomod.",
                    `
                        <div class="summary-grid">
                            <div class="summary-card"><span class="helper">Rust files</span><strong>${impact.totalRustFiles}</strong></div>
                            <div class="summary-card"><span class="helper">Matched</span><strong>${impact.matchedCount}</strong></div>
                            <div class="summary-card"><span class="helper">Ignored</span><strong>${impact.ignoredCount}</strong></div>
                            <div class="summary-card"><span class="helper">Uncovered</span><strong>${impact.uncoveredCount}</strong></div>
                        </div>
                        <div class="impact-list">
                            ${impact.items && impact.items.length > 0
                                ? impact.items.slice(0, 18).map(renderImpactItem).join("")
                                : `<div class="empty-state small">No Rust files were discovered under this config yet.</div>`
                            }
                        </div>
                    `,
                    `<span class="badge">${impact.shadowedCount} shadowed</span>`
                )}
                ${renderDisclosure(
                    "playground",
                    "Matching Playground",
                    "Test any Rust path and see which rule wins, which ones miss, and why.",
                    renderPlayground(insights?.playground || null),
                    `<span class="badge">${playgroundInput.trim() ? "Path loaded" : "Idle"}</span>`
                )}
                ${renderDisclosure(
                    "audit",
                    "Audit",
                    "Diagnostics, duplicate rules, uncovered files, and other confidence checks for this config subtree.",
                    `
                        <div class="summary-grid">
                            <div class="summary-card"><span class="helper">Issues</span><strong>${audit.issueCount}</strong></div>
                            <div class="summary-card"><span class="helper">Invalid</span><strong>${audit.invalidCount}</strong></div>
                            <div class="summary-card"><span class="helper">Duplicates</span><strong>${audit.duplicateRuleCount}</strong></div>
                            <div class="summary-card"><span class="helper">Unused</span><strong>${audit.unusedRuleCount}</strong></div>
                        </div>
                        <div class="diagnostic-list">
                            ${audit.issues && audit.issues.length > 0
                                ? audit.issues.map(renderAuditIssue).join("")
                                : `<div class="empty-state small">No audit findings right now.</div>`
                            }
                        </div>
                    `,
                    `<span class="badge">${audit.overlapCount} overlaps</span>`
                )}
                ${renderDisclosure(
                    "history",
                    "Local History",
                    "Session-local restore points for this .rautomod draft.",
                    `
                        <div class="stack">
                            ${historyEntries.length > 0
                                ? historyEntries.map((entry, index) => renderHistoryItem(entry, index)).join("")
                                : `<div class="empty-state small">No local snapshots yet. Create one before larger edits if you want quick restore points.</div>`
                            }
                        </div>
                    `,
                    `<span class="badge">${historyEntries.length} snapshots</span>`
                )}
            </div>
        `;
    }

    function renderRawColumn() {
        return `
            <section class="panel raw-pane studio-animated">
                <div class="panel-header">
                    <div>
                        <h2>Raw File</h2>
                        <div class="helper">Raw and Visual stay in sync until you edit raw manually. When they diverge, Studio calls that out explicitly before you apply one over the other.</div>
                    </div>
                    <div class="hero-actions">
                        <button class="button ghost" data-action="format-raw">Format Raw</button>
                        <button class="button primary" data-action="apply-raw">Apply Raw Changes</button>
                    </div>
                </div>
                <div class="raw-banner">
                    Unmanaged comments and blocks are preserved on visual saves when the serializer can map them back onto the generated structure.
                </div>
                <textarea data-focus-id="raw-editor" data-role="raw-editor" spellcheck="false">${escapeHtml(rawDraftText)}</textarea>
            </section>
        `;
    }

    function render() {
        if (!state || !draft) {
            renderLoadingSkeleton();
            return;
        }

        const layoutClass = mode === "raw" ? "raw" : mode === "split" ? "split" : "visual";
        const dirtyBadges = [];

        if (hasVisualChanges()) {
            dirtyBadges.push('<span class="badge badge-warning">Visual draft</span>');
        }
        if (hasRawChanges()) {
            dirtyBadges.push('<span class="badge badge-warning">Raw draft</span>');
        }
        if (hasDivergedDrafts()) {
            dirtyBadges.push('<span class="badge badge-error">Diverged</span>');
        }
        if (dirtyBadges.length === 0) {
            dirtyBadges.push('<span class="badge badge-success">Saved</span>');
        }

        const breadcrumbs = (state.fileName || state.uri || "")
            .split(/[\\/]/)
            .filter(Boolean)
            .slice(-4)
            .join(" / ");

        root.innerHTML = `
            <div class="editor-shell">
                <section class="hero studio-animated">
                    <div class="hero-top">
                        <div>
                            <div class="eyebrow">Rust AutoMod Studio</div>
                            <div class="breadcrumb">${escapeHtml(state.workspaceName || "workspace")} / ${escapeHtml(breadcrumbs)}</div>
                            <h1>.rautomod Visual Editor</h1>
                            <p>Edit visually, keep raw nearby, preview impact across the subtree, and understand exactly why a rule wins or loses.</p>
                        </div>
                        <div class="hero-actions">
                            ${dirtyBadges.join("")}
                            <span class="badge">${(insights?.audit?.issueCount || 0)} audit</span>
                            <span class="badge">${draft.rules.length} rules</span>
                        </div>
                    </div>
                </section>
                <div class="toolbar">
                    <div class="tabs">
                        <button class="tab ${mode === "visual" ? "active" : ""}" data-action="set-mode" data-mode="visual">Visual</button>
                        <button class="tab ${mode === "split" ? "active" : ""}" data-action="set-mode" data-mode="split">Split</button>
                        <button class="tab ${mode === "raw" ? "active" : ""}" data-action="set-mode" data-mode="raw">Raw</button>
                    </div>
                    <div class="hero-actions">
                        <button class="button ghost" data-action="refresh-insights">Refresh Analysis</button>
                        <button class="button ghost" data-action="reset">Reset Draft</button>
                        <button class="button ghost" data-action="open-raw">Open Raw Externally</button>
                    </div>
                </div>
                ${hasDivergedDrafts() ? `
                    <section class="raw-banner warning">
                        Visual and Raw now diverge. Applying one side will overwrite the other unless you merge them first.
                    </section>
                ` : ""}
                <div class="content-grid ${layoutClass}">
                    ${mode !== "raw" ? renderVisualColumn() : ""}
                    ${mode !== "visual" ? renderRawColumn() : ""}
                </div>
            </div>
        `;
    }

    function moveRule(fromIndex, toIndex) {
        if (!draft?.rules[fromIndex] || toIndex < 0 || toIndex >= draft.rules.length) {
            return;
        }

        const [rule] = draft.rules.splice(fromIndex, 1);
        draft.rules.splice(toIndex, 0, rule);
        syncVisualToRaw();
        requestInsightsRefresh();
        scheduleRender();
    }

    function restoreHistoryEntry(index) {
        const entry = getHistoryEntries()[index];
        if (!entry) {
            return;
        }

        if (hasUnsavedChanges()) {
            const shouldReplace = window.confirm("Replace the current draft with this local history snapshot?");
            if (!shouldReplace) {
                return;
            }
        }

        draft = ensureRuleIds(entry.draft);
        rawDraftText = entry.rawText;
        rawEditedManually = true;
        requestInsightsRefresh();
        scheduleRender();
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
                setMode(target.getAttribute("data-mode") || "visual");
                return;
            case "add-rule":
                draft.rules.push(createRule());
                syncVisualToRaw();
                requestInsightsRefresh();
                scheduleRender();
                return;
            case "duplicate-rule":
                if (!Number.isNaN(index) && draft.rules[index]) {
                    draft.rules.splice(index + 1, 0, Object.assign({}, clone(draft.rules[index]), { id: uid("rule") }));
                    syncVisualToRaw();
                    requestInsightsRefresh();
                    scheduleRender();
                }
                return;
            case "remove-rule":
                if (!Number.isNaN(index) && draft.rules[index]) {
                    draft.rules.splice(index, 1);
                    syncVisualToRaw();
                    requestInsightsRefresh();
                    scheduleRender();
                }
                return;
            case "move-rule-up":
                moveRule(index, index - 1);
                return;
            case "move-rule-down":
                moveRule(index, index + 1);
                return;
            case "fix-document":
                applyRecommendedDocumentFixes();
                return;
            case "fix-rule":
                applyRecommendedRuleFixes(index);
                return;
            case "apply-fix":
                applyFieldFix(
                    target.getAttribute("data-scope"),
                    index,
                    target.getAttribute("data-field"),
                    decodeDataValue(target.getAttribute("data-value"))
                );
                return;
            case "add-chip": {
                const chipInput = target.parentElement?.querySelector('[data-role="chip-input"]');
                if (chipInput instanceof HTMLInputElement) {
                    commitChipInput(chipInput);
                }
                return;
            }
            case "remove-chip": {
                const scope = target.getAttribute("data-chip-scope");
                const field = target.getAttribute("data-chip-field");
                const chipValue = decodeDataValue(target.getAttribute("data-chip-value"));
                const nextValues = (scope === "document"
                    ? splitChipList(draft[field] || "")
                    : splitChipList(draft.rules[index]?.[field] || ""))
                    .filter(value => value !== chipValue);
                updateChipField(scope, index, field, nextValues);
                return;
            }
            case "apply-visual":
                if (hasDivergedDrafts()) {
                    const shouldContinue = window.confirm("Raw edits diverge from the visual draft. Apply the visual version anyway?");
                    if (!shouldContinue) {
                        return;
                    }
                }
                pushHistorySnapshot("Before visual apply", draft, rawDraftText);
                acceptIncomingState = true;
                draft.rawText = rawDraftText || state.rawText || "";
                vscode.postMessage({ type: "applyVisual", value: draft });
                return;
            case "apply-raw":
                if (hasDivergedDrafts()) {
                    const shouldContinue = window.confirm("Visual edits diverge from the raw draft. Apply the raw version anyway?");
                    if (!shouldContinue) {
                        return;
                    }
                }
                pushHistorySnapshot("Before raw apply", draft, rawDraftText);
                acceptIncomingState = true;
                vscode.postMessage({ type: "applyRaw", rawText: normalizeDraftWhitespace(rawDraftText) });
                return;
            case "format-raw":
                vscode.postMessage({ type: "formatRaw", rawText: rawDraftText });
                return;
            case "open-raw":
                vscode.postMessage({ type: "openRaw" });
                return;
            case "refresh-insights":
                requestInsightsRefresh();
                return;
            case "run-playground":
                requestInsightsRefresh();
                return;
            case "snapshot":
                pushHistorySnapshot("Manual snapshot", draft, rawDraftText);
                scheduleRender();
                return;
            case "restore-history":
                restoreHistoryEntry(Number(target.getAttribute("data-history-index")));
                return;
            case "reset":
                if (hasUnsavedChanges()) {
                    const shouldReset = window.confirm("Discard the current Studio draft and reset to the last saved .rautomod?");
                    if (!shouldReset) {
                        return;
                    }
                }
                draft = clone(state);
                rawDraftText = state.rawText || "";
                rawEditedManually = false;
                requestInsightsRefresh();
                scheduleRender();
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
        }
    });

    root.addEventListener("input", event => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) || !draft) {
            return;
        }

        if (target.getAttribute("data-role") === "raw-editor") {
            rawDraftText = target.value;
            rawEditedManually = true;
            requestInsightsRefresh();
            scheduleRender();
            return;
        }

        if (target.getAttribute("data-role") === "playground-input") {
            playgroundInput = target.value;
            persistUiState();
            requestInsightsRefresh();
            return;
        }

        if (target.getAttribute("data-role") === "chip-input") {
            return;
        }

        const scope = target.getAttribute("data-scope");
        const field = target.getAttribute("data-field");
        const index = Number(target.getAttribute("data-index"));
        if (!scope || !field) {
            return;
        }

        if (scope === "document") {
            updateDocumentField(field, target.value);
            return;
        }

        updateRuleField(index, field, target.value);
    });

    root.addEventListener("keydown", event => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement) || target.getAttribute("data-role") !== "chip-input") {
            return;
        }

        if (event.key === "Enter") {
            event.preventDefault();
            commitChipInput(target);
        }
    });

    root.addEventListener("focusout", event => {
        const target = event.target;
        if (target instanceof HTMLInputElement && target.getAttribute("data-role") === "chip-input" && target.value.trim()) {
            commitChipInput(target);
        }
    });

    root.addEventListener("dragstart", event => {
        const target = event.target.closest("[data-rule-index]");
        if (!target) {
            return;
        }

        draggingRuleId = target.getAttribute("data-rule-id");
        event.dataTransfer.effectAllowed = "move";
    });

    root.addEventListener("dragover", event => {
        const target = event.target.closest("[data-rule-index]");
        if (!target || draggingRuleId === null) {
            return;
        }

        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
    });

    root.addEventListener("drop", event => {
        const target = event.target.closest("[data-rule-index]");
        if (!target || draggingRuleId === null || !draft) {
            return;
        }

        event.preventDefault();
        const fromIndex = draft.rules.findIndex(rule => rule.id === draggingRuleId);
        const toIndex = Number(target.getAttribute("data-rule-index"));
        draggingRuleId = null;
        moveRule(fromIndex, toIndex);
    });

    root.addEventListener("dragend", () => {
        draggingRuleId = null;
    });

    root.addEventListener("toggle", event => {
        const details = event.target;
        if (!(details instanceof HTMLDetailsElement)) {
            return;
        }

        const disclosureId = details.getAttribute("data-disclosure-id");
        if (disclosureId) {
            setOpenSection(disclosureId, details.open);
        }
    }, true);

    window.addEventListener("message", event => {
        const message = event.data;
        switch (message.type) {
            case "setState":
                setState(message.value);
                break;
            case "setInsights":
                setInsights(message.value);
                break;
            case "formattedRaw":
                rawDraftText = message.rawText || "";
                rawEditedManually = true;
                requestInsightsRefresh();
                scheduleRender();
                break;
        }
    });

    window.addEventListener("error", event => {
        vscode.postMessage({
            type: "logWebviewError",
            context: "editor",
            message: event.message || "Unknown webview error."
        });
        renderRuntimeError(event.message || "Unknown webview error.");
    });

    window.addEventListener("unhandledrejection", event => {
        const reason = event.reason && event.reason.message
            ? event.reason.message
            : String(event.reason || "Unknown promise rejection.");
        vscode.postMessage({
            type: "logWebviewError",
            context: "editor-promise",
            message: reason
        });
        renderRuntimeError(reason);
    });

    renderLoadingSkeleton();
    vscode.postMessage({ type: "ready" });
})();
