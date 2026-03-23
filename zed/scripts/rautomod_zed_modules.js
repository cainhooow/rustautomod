"use strict";

const { fileURLToPath, pathToFileURL } = require("url");
const shared = globalThis.__RUST_AUTOMOD_ZED_SHARED__ || require("./rautomod_zed_core");

const REGISTRATION_TARGET_NAMES = new Set(["mod.rs", "lib.rs", "main.rs"]);
const MODULE_CODE_ACTION_KIND = "source.fixAll.rustautomod";

function filePathFromUri(uri) {
    return shared.path.normalize(fileURLToPath(uri));
}

function fileUriFromPath(filePath) {
    return pathToFileURL(shared.path.resolve(filePath)).toString();
}

function moduleNameFromFilePath(filePath) {
    const baseName = shared.path.basename(filePath);
    if (baseName === "lib.rs" || baseName === "main.rs") {
        return null;
    }
    if (baseName === "mod.rs") {
        return shared.path.basename(shared.path.dirname(filePath));
    }
    if (shared.path.extname(baseName) !== ".rs") {
        return null;
    }
    return baseName.slice(0, -3);
}

function parentContainerDirForModuleFile(filePath) {
    const baseName = shared.path.basename(filePath);
    if (baseName === "lib.rs" || baseName === "main.rs") {
        return null;
    }
    if (baseName === "mod.rs") {
        return shared.path.dirname(shared.path.dirname(filePath));
    }
    return shared.path.dirname(filePath);
}

function resolveParentRegistrationTarget(filePath) {
    const containerDir = parentContainerDirForModuleFile(filePath);
    if (!containerDir) {
        return null;
    }

    const layout = shared.detectLayout(containerDir);
    return shared.resolveRegistrationTarget(containerDir, layout);
}

function childContainerDirForModuleEntry(filePath) {
    const baseName = shared.path.basename(filePath);
    if (REGISTRATION_TARGET_NAMES.has(baseName)) {
        return shared.path.dirname(filePath);
    }

    const moduleName = moduleNameFromFilePath(filePath);
    if (!moduleName) {
        return null;
    }

    const siblingDir = shared.path.join(shared.path.dirname(filePath), moduleName);
    if (!shared.fs.existsSync(siblingDir)) {
        return null;
    }

    const stats = shared.fs.statSync(siblingDir);
    return stats.isDirectory() ? siblingDir : null;
}

function collectChildModuleEntryPaths(filePath) {
    const childDir = childContainerDirForModuleEntry(filePath);
    if (!childDir || !shared.fs.existsSync(childDir)) {
        return [];
    }

    const currentResolved = shared.path.resolve(filePath);
    const dirEntries = shared.fs.readdirSync(childDir, { withFileTypes: true });
    const childEntries = [];
    const consumedModernModules = new Set();

    for (const entry of dirEntries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const moduleName = entry.name;
        const modernCandidate = shared.path.join(childDir, `${moduleName}.rs`);
        if (shared.fs.existsSync(modernCandidate)) {
            childEntries.push(modernCandidate);
            consumedModernModules.add(moduleName);
            continue;
        }

        const classicCandidate = shared.path.join(childDir, moduleName, "mod.rs");
        if (shared.fs.existsSync(classicCandidate)) {
            childEntries.push(classicCandidate);
        }
    }

    for (const entry of dirEntries) {
        if (!entry.isFile() || shared.path.extname(entry.name) !== ".rs") {
            continue;
        }

        if (REGISTRATION_TARGET_NAMES.has(entry.name)) {
            continue;
        }

        const fullPath = shared.path.join(childDir, entry.name);
        if (shared.path.resolve(fullPath) === currentResolved) {
            continue;
        }

        const moduleName = entry.name.slice(0, -3);
        if (consumedModernModules.has(moduleName)) {
            continue;
        }

        childEntries.push(fullPath);
    }

    return childEntries
        .map(candidate => shared.path.resolve(candidate))
        .sort((left, right) => left.localeCompare(right));
}

function getOpenDocument(openDocuments, filePath) {
    return openDocuments instanceof Map ? openDocuments.get(shared.path.resolve(filePath)) || null : null;
}

function readDocumentText(filePath, openDocuments) {
    const openDocument = getOpenDocument(openDocuments, filePath);
    if (openDocument) {
        return openDocument.text;
    }
    if (!shared.fs.existsSync(filePath)) {
        return null;
    }
    return shared.fs.readFileSync(filePath, "utf8");
}

function fullDocumentRange(text) {
    const normalized = String(text || "").replace(/\r\n/g, "\n");
    const lines = normalized.split("\n");
    const lastLine = Math.max(0, lines.length - 1);
    const lastCharacter = lines[lastLine] ? lines[lastLine].length : 0;

    return {
        start: { line: 0, character: 0 },
        end: { line: lastLine, character: lastCharacter }
    };
}

function zeroRange() {
    return {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 }
    };
}

function appendBlock(content, block) {
    const trimmed = String(content || "").trimEnd();
    const normalizedBlock = String(block || "").trimEnd();
    if (!normalizedBlock) {
        return trimmed ? `${trimmed}\n` : "";
    }
    return trimmed ? `${trimmed}\n${normalizedBlock}\n` : `${normalizedBlock}\n`;
}

function declarationExists(content, moduleName) {
    const regex = new RegExp(
        `(^|\\n)\\s*(?:pub(?:\\([^\\n]+\\))?\\s+)?mod\\s+${shared.escapeRegExp(moduleName)}\\s*;`,
        "m"
    );
    return regex.test(String(content || ""));
}

function declarationBlockForModuleFile(filePath) {
    const moduleName = moduleNameFromFilePath(filePath);
    if (!moduleName) {
        return null;
    }

    const resolved = shared.resolveProjectConfig(filePath);
    if (resolved && resolved.ignored) {
        return null;
    }

    const cfgValues = Array.isArray(resolved?.rule?.cfg) ? resolved.rule.cfg : [];
    const visibility = resolved?.rule?.visibility || "pub";
    const lines = cfgValues.map(cfgValue => formatCfgAttribute(cfgValue));
    lines.push(shared.declarationLine(moduleName, visibility));
    return lines.join("\n");
}

function formatCfgAttribute(cfgValue) {
    const trimmed = String(cfgValue || "").trim();
    if (!trimmed) {
        return "#[cfg()]";
    }
    if (trimmed.startsWith("#[cfg(") && trimmed.endsWith(")]")) {
        return trimmed;
    }
    return `#[cfg(${trimmed})]`;
}

function registrationStatusForModuleFile(filePath, openDocuments) {
    const moduleName = moduleNameFromFilePath(filePath);
    if (!moduleName) {
        return { eligible: false, reason: "not_a_module_entry" };
    }

    const targetPath = resolveParentRegistrationTarget(filePath);
    if (!targetPath) {
        return { eligible: false, reason: "no_parent_target" };
    }

    const block = declarationBlockForModuleFile(filePath);
    if (!block) {
        return { eligible: false, reason: "ignored_or_invalid" };
    }

    const targetText = readDocumentText(targetPath, openDocuments);
    const targetExists = targetText !== null;
    const exists = targetExists ? declarationExists(targetText, moduleName) : false;

    return {
        eligible: true,
        moduleName,
        targetPath,
        targetExists,
        targetText: targetText || "",
        block,
        exists,
        createTarget: !targetExists
    };
}

function buildRegisterModulePlan(filePath, openDocuments) {
    const status = registrationStatusForModuleFile(filePath, openDocuments);
    if (!status.eligible || status.exists) {
        return null;
    }

    return {
        kind: "register-module",
        title: status.createTarget
            ? "Rust AutoMod: Create parent target and register this module"
            : "Rust AutoMod: Register this module in the parent target",
        moduleName: status.moduleName,
        targetPath: status.targetPath,
        currentText: status.targetText,
        newText: appendBlock(status.targetText, status.block),
        createTarget: status.createTarget
    };
}

function buildSyncChildModulesPlan(filePath, openDocuments) {
    const targetText = readDocumentText(filePath, openDocuments);
    if (targetText === null) {
        return null;
    }

    const childEntries = collectChildModuleEntryPaths(filePath);
    if (childEntries.length === 0) {
        return null;
    }

    const missingBlocks = [];
    const missingModules = [];

    for (const childPath of childEntries) {
        const status = registrationStatusForModuleFile(childPath, openDocuments);
        if (!status.eligible || status.exists) {
            continue;
        }

        if (shared.path.resolve(status.targetPath) !== shared.path.resolve(filePath)) {
            continue;
        }

        missingBlocks.push(status.block);
        missingModules.push(status.moduleName);
    }

    if (missingBlocks.length === 0) {
        return null;
    }

    let nextText = targetText;
    for (const block of missingBlocks) {
        nextText = appendBlock(nextText, block);
    }

    return {
        kind: "sync-children",
        title: missingBlocks.length === 1
            ? "Rust AutoMod: Register the missing child module"
            : `Rust AutoMod: Register ${missingBlocks.length} missing child modules`,
        targetPath: shared.path.resolve(filePath),
        currentText: targetText,
        newText: nextText,
        missingModules
    };
}

function buildWorkspaceEdit(plan) {
    const targetUri = fileUriFromPath(plan.targetPath);
    if (!plan.createTarget) {
        return {
            changes: {
                [targetUri]: [
                    {
                        range: fullDocumentRange(plan.currentText),
                        newText: plan.newText
                    }
                ]
            }
        };
    }

    return {
        documentChanges: [
            {
                kind: "create",
                uri: targetUri
            },
            {
                textDocument: {
                    uri: targetUri,
                    version: null
                },
                edits: [
                    {
                        range: zeroRange(),
                        newText: plan.newText
                    }
                ]
            }
        ]
    };
}

function rustDiagnosticsForFile(filePath, openDocuments) {
    const diagnostics = [];
    const registerPlan = buildRegisterModulePlan(filePath, openDocuments);
    if (registerPlan) {
        diagnostics.push({
            range: diagnosticRangeForText(readDocumentText(filePath, openDocuments)),
            severity: 2,
            code: "missing_parent_registration",
            source: "rustautomod-zed",
            message: registerPlan.createTarget
                ? `Module is not registered yet and the parent target ${shared.path.basename(registerPlan.targetPath)} does not exist.`
                : `Module is not registered in ${shared.path.basename(registerPlan.targetPath)}.`
        });
    }

    const syncPlan = buildSyncChildModulesPlan(filePath, openDocuments);
    if (syncPlan) {
        diagnostics.push({
            range: diagnosticRangeForText(readDocumentText(filePath, openDocuments)),
            severity: 2,
            code: "missing_child_registrations",
            source: "rustautomod-zed",
            message: syncPlan.missingModules.length === 1
                ? `One child module is missing from this target: ${syncPlan.missingModules[0]}.`
                : `${syncPlan.missingModules.length} child modules are missing from this target: ${syncPlan.missingModules.join(", ")}.`
        });
    }

    return diagnostics;
}

function diagnosticRangeForText(text) {
    const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
    const firstLineLength = lines[0] ? lines[0].length : 0;
    return {
        start: { line: 0, character: 0 },
        end: { line: 0, character: firstLineLength }
    };
}

const sharedWithModules = {
    ...shared,
    MODULE_CODE_ACTION_KIND,
    filePathFromUri,
    fileUriFromPath,
    moduleNameFromFilePath,
    parentContainerDirForModuleFile,
    resolveParentRegistrationTarget,
    childContainerDirForModuleEntry,
    collectChildModuleEntryPaths,
    readDocumentText,
    fullDocumentRange,
    appendBlock,
    declarationExists,
    declarationBlockForModuleFile,
    registrationStatusForModuleFile,
    buildRegisterModulePlan,
    buildSyncChildModulesPlan,
    buildWorkspaceEdit,
    rustDiagnosticsForFile
};

globalThis.__RUST_AUTOMOD_ZED_SHARED__ = sharedWithModules;
module.exports = sharedWithModules;
