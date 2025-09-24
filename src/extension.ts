import * as vscode from 'vscode';
import { validateRautomod } from './linting/linting.automod';
import { completionProvider } from './linting/linting.completion';
import { hiddenModFiles } from './workbench/control';
import { handleFileDelete, handleNewFile } from './automod/automodModFile';

export function activate(context: vscode.ExtensionContext) {
	console.log("RUST AUTOMOD INIT")
	const watcher = vscode.workspace.createFileSystemWatcher("**/*.rs");
	const diagnosticCollection = vscode.languages.createDiagnosticCollection("rustautomod");

	const toggleHide = vscode.commands.registerCommand("rustautomod.toggleHideModRs", hiddenModFiles);

	vscode.workspace.onDidOpenTextDocument(doc => validateRautomod(doc, diagnosticCollection));
	vscode.workspace.onDidSaveTextDocument(doc => validateRautomod(doc, diagnosticCollection));

	watcher.onDidCreate(async (uri) => {
		await handleNewFile(uri);
	});

	watcher.onDidDelete(async (uri) => {
		await handleFileDelete(uri)
	});

	context.subscriptions.push(watcher);
	context.subscriptions.push(toggleHide);
	context.subscriptions.push(diagnosticCollection);
	context.subscriptions.push(completionProvider);
}

export function deactivate() { }