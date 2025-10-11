import * as vscode from 'vscode';
import { validateRautomod } from './linting/linting.automod';
import { completionProvider } from './linting/linting.completion';
import { hiddenModFiles } from './workbench/control';
import { handleFileDelete, handleNewFile } from './automod/automodModFile';

export function activate(context: vscode.ExtensionContext) {
	console.log("RUST AUTOMOD INIT");
	const watcher = vscode.workspace.createFileSystemWatcher("**/*.rs");
	const diagnosticCollection = vscode.languages.createDiagnosticCollection("rustautomod");

	const toggleHide = vscode.commands.registerCommand("rustautomod.toggleHideModRs", hiddenModFiles);

	vscode.workspace.onDidOpenTextDocument(doc => validateRautomod(doc, diagnosticCollection));
	vscode.workspace.onDidSaveTextDocument(doc => validateRautomod(doc, diagnosticCollection));

	const pendingCreatedUris = new Set<string>();
	const pendingDeletedUris = new Set<string>();
	const debounceDelay = 500;
	let debounceTimeout: NodeJS.Timeout | null = null;

	const processBatch = async () => {
		const createdUris = Array.from(pendingCreatedUris);
		const deletedUris = Array.from(pendingDeletedUris);

		pendingCreatedUris.clear();
		pendingDeletedUris.clear();
		debounceTimeout = null;

		if (createdUris.length === 0 && deletedUris.length === 0) return;

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
		if (pendingDeletedUris.has(filePath)) {
			pendingDeletedUris.delete(filePath);
			console.log(`RUST AUTOMOD: Cancelled deletion for ${filePath} (file created)`);
			return;
		}

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

		pendingDeletedUris.add(filePath);
		scheduleBatchProcessing();
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
	}));
}

export function deactivate() { }