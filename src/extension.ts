import * as vscode from 'vscode';
import { validateRautomod } from './linting/linting.automod';
import { completionProvider } from './linting/linting.completion';
import { rautomodCodeActions } from './linting/linting.codeActions';
import { formattingProvider } from './linting/linting.formatting';
import {
	configureAutomodRuntime,
	createModulePair,
	explainAutomod,
	handleFileDelete,
	handleFileRename,
	handleNewFile,
	ignorePathInRautomod,
	moveModuleToCrateRoot,
	openAutomodLog,
	previewAutomod,
	regenerateModules,
	scaffoldRautomod,
	setModuleVisibility,
	showEffectiveConfig,
	undoLastAutomodAction
} from './automod/automodModFile';
import { AutomodRuntime } from './automod/automodRuntime';
import { isValidRustPath } from './utils/pathValidator';
import { ModVisibilityController } from './workbench/control';
import { openRautomodRaw, openRautomodVisual, registerRautomodCustomEditor } from './ui/rautomodCustomEditor';
import { openRautomodManager, registerRautomodManagerView } from './ui/rautomodManagerView';
import path from 'path';

export function activate(context: vscode.ExtensionContext) {
	console.log("RUST AUTOMOD INIT");

	const automodRuntime = new AutomodRuntime();
	configureAutomodRuntime(automodRuntime);
	const modVisibilityController = new ModVisibilityController(context);
	
	// Create a watcher that excludes known problematic directories
	const watcher = vscode.workspace.createFileSystemWatcher(
		"**/*.rs",
		false, // ignoreCreateEvents
		false, // ignoreChangeEvents
		false  // ignoreDeleteEvents
	);
	
	const diagnosticCollection = vscode.languages.createDiagnosticCollection("rustautomod");

	const toggleHide = vscode.commands.registerCommand(
		"rustautomod.toggleHideModRs",
		() => modVisibilityController.toggleAutoHideIndexModRs()
	);
	const hideThisMod = vscode.commands.registerCommand(
		"rustautomod.hideThisModRs",
		(resource?: vscode.Uri) => modVisibilityController.hideThisModRs(resource)
	);
	const restoreHiddenMod = vscode.commands.registerCommand(
		"rustautomod.restoreHiddenModRs",
		(resource?: vscode.Uri) => modVisibilityController.restoreHiddenModRs(resource)
	);
	const previewCommand = vscode.commands.registerCommand(
		"rustautomod.previewAutomod",
		(resource?: vscode.Uri) => previewAutomod(resource)
	);
	const regenerateCommand = vscode.commands.registerCommand(
		"rustautomod.regenerateModules",
		(resource?: vscode.Uri) => regenerateModules(resource)
	);
	const undoCommand = vscode.commands.registerCommand(
		"rustautomod.undoLastAutomodAction",
		() => undoLastAutomodAction()
	);
	const explainCommand = vscode.commands.registerCommand(
		"rustautomod.explainAutomod",
		(resource?: vscode.Uri) => explainAutomod(resource)
	);
	const effectiveConfigCommand = vscode.commands.registerCommand(
		"rustautomod.showEffectiveConfig",
		(resource?: vscode.Uri) => showEffectiveConfig(resource)
	);
	const ignoreCommand = vscode.commands.registerCommand(
		"rustautomod.ignorePathInRautomod",
		(resource?: vscode.Uri) => ignorePathInRautomod(resource)
	);
	const scaffoldCommand = vscode.commands.registerCommand(
		"rustautomod.scaffoldRautomod",
		(resource?: vscode.Uri) => scaffoldRautomod(resource)
	);
	const createModulePairCommand = vscode.commands.registerCommand(
		"rustautomod.createModulePair",
		(resource?: vscode.Uri) => createModulePair(resource)
	);
	const setModuleVisibilityCommand = vscode.commands.registerCommand(
		"rustautomod.setModuleVisibility",
		(resource?: vscode.Uri, visibility?: "pub" | "pub(crate)" | "private") => setModuleVisibility(resource, visibility)
	);
	const moveModuleToCrateRootCommand = vscode.commands.registerCommand(
		"rustautomod.moveModuleToCrateRoot",
		(resource?: vscode.Uri) => moveModuleToCrateRoot(resource)
	);
	const openLogCommand = vscode.commands.registerCommand(
		"rustautomod.openLog",
		() => openAutomodLog()
	);
	const openVisualRautomodCommand = vscode.commands.registerCommand(
		"rustautomod.openRautomodVisual",
		(resource?: vscode.Uri) => openRautomodVisual(resource)
	);
	const openRawRautomodCommand = vscode.commands.registerCommand(
		"rustautomod.openRautomodRaw",
		(resource?: vscode.Uri) => openRautomodRaw(resource)
	);
	const openManagerCommand = vscode.commands.registerCommand(
		"rustautomod.openManager",
		() => openRautomodManager(context)
	);
	const configChangeListener = vscode.workspace.onDidChangeConfiguration(event => {
		modVisibilityController.handleConfigurationChange(event);
	});
	const workspaceFoldersChangeListener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
		void modVisibilityController.initialize();
	});

	vscode.workspace.onDidOpenTextDocument(doc => validateRautomod(doc, diagnosticCollection));
	vscode.workspace.onDidSaveTextDocument(doc => validateRautomod(doc, diagnosticCollection));
	vscode.workspace.onDidChangeTextDocument(event => validateRautomod(event.document, diagnosticCollection));

	const pendingCreatedUris = new Set<string>();
	const pendingDeletedUris = new Set<string>();
	const pendingRenames = new Map<string, string>();
	const recentDeletes = new Map<string, { timestamp: number, fileName: string }>();

	const debounceDelay = 500;
	const renameDetectionWindow = 300;
	let debounceTimeout: NodeJS.Timeout | null = null;

	const processBatch = async () => {
		const createdUris = Array.from(pendingCreatedUris);
		const deletedUris = Array.from(pendingDeletedUris);
		const renames = Array.from(pendingRenames.entries());

		pendingCreatedUris.clear();
		pendingDeletedUris.clear();
		pendingRenames.clear();
		debounceTimeout = null;

		if (createdUris.length === 0 && deletedUris.length === 0 && renames.length === 0) {return;}

		if (renames.length > 0) {
			console.log(`RUST AUTOMOD: Processing ${renames.length} renames (waiting for Rust Analyzer)...`);
			await new Promise(resolve => setTimeout(resolve, 1000));

			const renamePromises = renames.map(([oldPath, newPath]) => {
				handleFileRename(vscode.Uri.file(oldPath), vscode.Uri.file(newPath))
					.catch(err => {
						console.error(`RUST AUTOMOD ERROR: Error renaming ${oldPath} -> ${newPath}:`, err);
					});
			});

			await Promise.all(renamePromises);
		}

		if (deletedUris.length > 0) {
			const deletePromises = deletedUris.map((path) => {
				handleFileDelete(vscode.Uri.file(path)).catch(err => {
					console.error(`RUST AUTOMOD ERROR: Error deleting ${path}:`, err);
				});
			});

			await Promise.all(deletePromises);
		}

		if (createdUris.length > 0) {
			const createdPromises = createdUris.map((path) => {
				handleNewFile(vscode.Uri.file(path)).catch(err => {
					console.error(`RUST AUTOMOD ERROR: Error creating ${path}:`, err);
				});
			});

			await Promise.all(createdPromises);
		}

		console.log("RUST AUTOMOD: Batch process completed");
	};

	const scheduleBatchProcessing = () => {
		console.log("RUST AUTOMOD: Batch processing scheduled");

		if (debounceTimeout) {
			clearTimeout(debounceTimeout);
		}

		debounceTimeout = setTimeout(() => {
			processBatch();
		}, debounceDelay);
	};

	watcher.onDidCreate(async (uri) => {
		const filePath = uri.fsPath;

		if (path.basename(filePath) === "mod.rs") {
			modVisibilityController.scheduleRefresh(uri, true);
		}
		
		// CRITICAL: Validate path early to prevent operations in wrong directories
		if (!isValidRustPath(filePath)) {
			console.log(`RUST AUTOMOD: Ignoring create event for invalid path: ${filePath}`);
			return;
		}
		
		const fileName = path.basename(filePath, '.rs');
		const dirPath = path.dirname(filePath);

		if (pendingDeletedUris.has(filePath)) {
			pendingDeletedUris.delete(filePath);
			console.log(`RUST AUTOMOD: Cancelled deletion for ${filePath} (file created)`);
			return;
		}

		const isPartOfRename = Array.from(pendingRenames.values()).includes(filePath);
		if (isPartOfRename) {
			console.log(`RUST AUTOMOD: Skipping create for ${filePath} (part of rename)`);
			return;
		}

		const now = Date.now();
		let bestMatch = null;
		let bestScore = -1;

		for (const [deletedPath, info] of recentDeletes.entries()) {
			const timeDiff = now - info.timestamp;

			// Skip expired entries
			if (timeDiff >= renameDetectionWindow) {
				recentDeletes.delete(deletedPath);
				continue;
			}

			// Must be same directory and both .rs files
			if (path.dirname(deletedPath) !== dirPath || !deletedPath.endsWith('.rs')) {
				continue;
			}

			// Calculate similarity score (prefer name similarity + recency)
			const delName = info.fileName;
			let nameScore = 0;

			// Count matching prefix characters
			for (let i = 0; i < Math.min(delName.length, fileName.length); i++) {
				if (delName[i] === fileName[i]) {nameScore++;}
				else {break;}
			}

			// Prefer recent deletes (0-1 normalized, newer = higher score)
			const timeScore = 1 - (timeDiff / renameDetectionWindow);

			// Combined score: name similarity is more important
			const totalScore = (nameScore * 10) + timeScore;

			if (totalScore > bestScore) {
				bestScore = totalScore;
				bestMatch = deletedPath;
			}
		}

		if (bestMatch && bestScore > 0) {
			console.log(`RUST AUTOMOD: Detected rename ${bestMatch} -> ${filePath} (score: ${bestScore.toFixed(2)})`);
			pendingRenames.set(bestMatch, filePath);
			recentDeletes.delete(bestMatch);
			scheduleBatchProcessing();
			return;
		}

		// Not a rename, treat as new file
		pendingCreatedUris.add(filePath);
		scheduleBatchProcessing();
	});

	watcher.onDidDelete(async (uri) => {
		const filePath = uri.fsPath;

		if (path.basename(filePath) === "mod.rs") {
			modVisibilityController.scheduleRefresh(uri, true);
		}
		
		// CRITICAL: Validate path early to prevent operations in wrong directories
		if (!isValidRustPath(filePath)) {
			console.log(`RUST AUTOMOD: Ignoring delete event for invalid path: ${filePath}`);
			return;
		}

		if (pendingCreatedUris.has(filePath)) {
			pendingCreatedUris.delete(filePath);
			console.log(`RUST AUTOMOD: Cancelled creation for ${filePath} (file deleted)`);
			return;
		}

		if (pendingRenames.has(filePath)) {
			console.log(`RUST AUTOMOD: Skipping delete for ${filePath} (part of rename)`);
			return;
		}

		if (filePath.endsWith('.rs')) {
			const fileName = path.basename(filePath, '.rs');
			recentDeletes.set(filePath, {
				timestamp: Date.now(),
				fileName: fileName
			});

			setTimeout(() => {
				if (recentDeletes.has(filePath)) {
					recentDeletes.delete(filePath);
					if (!pendingRenames.has(filePath)) {
						pendingDeletedUris.add(filePath);
						scheduleBatchProcessing();
					}
				}
			}, renameDetectionWindow + 50);
		} else {
			pendingDeletedUris.add(filePath);
			scheduleBatchProcessing();
		}
	});

	watcher.onDidChange((uri) => {
		if (path.basename(uri.fsPath) === "mod.rs") {
			modVisibilityController.scheduleRefresh(uri);
		}
	});

	context.subscriptions.push(watcher);
	context.subscriptions.push(toggleHide);
	context.subscriptions.push(hideThisMod);
	context.subscriptions.push(restoreHiddenMod);
	context.subscriptions.push(previewCommand);
	context.subscriptions.push(regenerateCommand);
	context.subscriptions.push(undoCommand);
	context.subscriptions.push(explainCommand);
	context.subscriptions.push(effectiveConfigCommand);
	context.subscriptions.push(ignoreCommand);
	context.subscriptions.push(scaffoldCommand);
	context.subscriptions.push(createModulePairCommand);
	context.subscriptions.push(setModuleVisibilityCommand);
	context.subscriptions.push(moveModuleToCrateRootCommand);
	context.subscriptions.push(openLogCommand);
	context.subscriptions.push(openVisualRautomodCommand);
	context.subscriptions.push(openRawRautomodCommand);
	context.subscriptions.push(openManagerCommand);
	context.subscriptions.push(configChangeListener);
	context.subscriptions.push(workspaceFoldersChangeListener);
	context.subscriptions.push(automodRuntime);
	context.subscriptions.push(modVisibilityController);
	context.subscriptions.push(diagnosticCollection);
	context.subscriptions.push(completionProvider);
	context.subscriptions.push(rautomodCodeActions);
	context.subscriptions.push(formattingProvider);
	context.subscriptions.push(registerRautomodCustomEditor(context));
	context.subscriptions.push(registerRautomodManagerView(context));

	context.subscriptions.push(new vscode.Disposable(() => {
		if (debounceTimeout) {
			clearTimeout(debounceTimeout);
			debounceTimeout = null;
		}

		pendingCreatedUris.clear();
		pendingDeletedUris.clear();
		pendingRenames.clear();
		recentDeletes.clear();
	}));
	
	// Show startup notification with safety info
	console.log("RUST AUTOMOD: Active with path validation enabled");
	console.log("RUST AUTOMOD: Protected directories: .git, target, node_modules, and more");
	void modVisibilityController.initialize();
}

export function deactivate() { }
