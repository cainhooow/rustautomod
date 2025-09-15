// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { handleFileDelete, handleNewFile } from './automod';
import { validateRautomod } from './linting/linting.automod';
import { completionProvider } from './linting/linting.completion';
import { hiddenModFiles } from './workbench/control';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
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

// This method is called when your extension is deactivated
export function deactivate() { }
