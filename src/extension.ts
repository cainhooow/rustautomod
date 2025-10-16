import * as vscode from 'vscode';
import { validateRautomod } from './linting/linting.automod';
import { completionProvider } from './linting/linting.completion';
import { hiddenModFiles } from './workbench/control';
import { handleFileDelete, handleFileRename, handleNewFile } from './automod/automodModFile';
import path from 'path';

export function activate(context: vscode.ExtensionContext) {
	console.log("RUST AUTOMOD INIT");
	const watcher = vscode.workspace.createFileSystemWatcher("**/*.rs");
	const diagnosticCollection = vscode.languages.createDiagnosticCollection("rustautomod");

	const toggleHide = vscode.commands.registerCommand("rustautomod.toggleHideModRs", hiddenModFiles);

	vscode.workspace.onDidOpenTextDocument(doc => validateRautomod(doc, diagnosticCollection));
	vscode.workspace.onDidSaveTextDocument(doc => validateRautomod(doc, diagnosticCollection));

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

		if (createdUris.length === 0 && deletedUris.length === 0 && renames.length === 0) return;

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
				if (delName[i] === fileName[i]) nameScore++;
				else break;
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


	context.subscriptions.push(watcher);
	context.subscriptions.push(toggleHide);
	context.subscriptions.push(diagnosticCollection);
	context.subscriptions.push(completionProvider);

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
}

export function deactivate() { }