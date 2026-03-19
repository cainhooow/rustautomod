import path from "path";
import { promises as fs } from "fs";
import * as vscode from "vscode";
import {
    fileExists,
    isModulePairRegistrationFile,
    resolveSourceDirectoryForRegistrationFile
} from "../../automod/modFileSystem";
import { parseManagedDeclarations } from "../../automod/modDeclarations";
import { isBlacklistedPath } from "../../utils/pathValidator";
import {
    RautomodModuleTreeNode,
    RautomodWorkspaceModuleTree
} from "./rautomodStudioTypes";

interface TreeBuildContext {
    id: string;
    name: string;
    relativePath: string;
    declarationFilePath: string;
    declarationFileUri: string;
    kind: "crate" | "module";
    layout: RautomodModuleTreeNode["layout"];
    visibility?: string;
    sourceFilePath?: string;
    sourceFileUri?: string;
    childContainerPath?: string;
    canCreateChild: boolean;
    movableToCrateRoot: boolean;
}

export async function collectWorkspaceModuleTree(
    workspaceFolder: vscode.WorkspaceFolder
): Promise<RautomodWorkspaceModuleTree> {
    if (!await fileExists(workspaceFolder.uri.fsPath)) {
        return createEmptyWorkspaceModuleTree(workspaceFolder);
    }

    const crateRoots = await collectCrateRootFiles(workspaceFolder.uri.fsPath);
    const roots = await Promise.all(crateRoots.map(crateRoot =>
        buildModuleTreeFromRegistrationFile(
            crateRoot,
            workspaceFolder.uri.fsPath,
            {
                id: crateRoot,
                name: path.basename(crateRoot, ".rs"),
                relativePath: normalizePath(path.relative(workspaceFolder.uri.fsPath, crateRoot)),
                declarationFilePath: crateRoot,
                declarationFileUri: vscode.Uri.file(crateRoot).toString(),
                kind: "crate",
                layout: "crate_root",
                visibility: undefined,
                sourceFilePath: crateRoot,
                sourceFileUri: vscode.Uri.file(crateRoot).toString(),
                childContainerPath: path.dirname(crateRoot),
                canCreateChild: true,
                movableToCrateRoot: false
            }
        )
    ));

    return {
        workspaceName: workspaceFolder.name,
        workspaceUri: workspaceFolder.uri.toString(),
        roots
    };
}

export function createEmptyWorkspaceModuleTree(
    workspaceFolder: vscode.WorkspaceFolder
): RautomodWorkspaceModuleTree {
    return {
        workspaceName: workspaceFolder.name,
        workspaceUri: workspaceFolder.uri.toString(),
        roots: []
    };
}

async function buildModuleTreeFromRegistrationFile(
    registrationFilePath: string,
    workspaceRootPath: string,
    context: TreeBuildContext
): Promise<RautomodModuleTreeNode> {
    const content = await readFileIfExists(registrationFilePath) ?? "";
    const declarations = parseManagedDeclarations(content.split(/\r?\n/))
        .filter(declaration => declaration.kind === "mod");

    const children = await Promise.all(declarations.map(async declaration => {
        const childSource = await resolveChildModuleSourcePath(registrationFilePath, declaration.moduleName);
        const fallbackFilePath = path.join(
            await resolveSourceDirectoryForRegistrationFile(registrationFilePath),
            `${declaration.moduleName}.rs`
        );

        const nextContext: TreeBuildContext = {
            id: childSource?.filePath ?? `${registrationFilePath}:${declaration.moduleName}`,
            name: declaration.moduleName,
            relativePath: normalizePath(path.relative(workspaceRootPath, childSource?.filePath ?? fallbackFilePath)),
            declarationFilePath: registrationFilePath,
            declarationFileUri: vscode.Uri.file(registrationFilePath).toString(),
            kind: "module",
            layout: childSource?.layout ?? "missing",
            visibility: declaration.visibility,
            sourceFilePath: childSource?.filePath,
            sourceFileUri: childSource?.filePath ? vscode.Uri.file(childSource.filePath).toString() : undefined,
            childContainerPath: childSource?.childContainerPath,
            canCreateChild: Boolean(childSource?.childContainerPath),
            movableToCrateRoot: Boolean(childSource?.filePath && childSource.layout === "leaf")
        };

        if (childSource?.registrationFilePath) {
            return buildModuleTreeFromRegistrationFile(childSource.registrationFilePath, workspaceRootPath, nextContext);
        }

        return {
            id: nextContext.id,
            name: nextContext.name,
            relativePath: nextContext.relativePath,
            sourceFileUri: nextContext.sourceFileUri,
            sourceFilePath: nextContext.sourceFilePath,
            declarationFileUri: nextContext.declarationFileUri,
            visibility: nextContext.visibility,
            kind: nextContext.kind,
            layout: nextContext.layout,
            canCreateChild: nextContext.canCreateChild,
            movableToCrateRoot: nextContext.movableToCrateRoot,
            childContainerUri: nextContext.childContainerPath ? vscode.Uri.file(nextContext.childContainerPath).toString() : undefined,
            children: []
        };
    }));

    return {
        id: context.id,
        name: context.name,
        relativePath: context.relativePath,
        sourceFileUri: context.sourceFileUri,
        sourceFilePath: context.sourceFilePath,
        declarationFileUri: context.declarationFileUri,
        visibility: context.visibility,
        kind: context.kind,
        layout: context.layout,
        canCreateChild: context.canCreateChild,
        movableToCrateRoot: context.movableToCrateRoot,
        childContainerUri: context.childContainerPath ? vscode.Uri.file(context.childContainerPath).toString() : undefined,
        children
    };
}

async function resolveChildModuleSourcePath(
    registrationFilePath: string,
    moduleName: string
): Promise<{
    filePath?: string;
    registrationFilePath?: string;
    layout: RautomodModuleTreeNode["layout"];
    childContainerPath?: string;
} | null> {
    const sourceDirectory = await resolveSourceDirectoryForRegistrationFile(registrationFilePath);
    const leafFilePath = path.join(sourceDirectory, `${moduleName}.rs`);
    const classicFilePath = path.join(sourceDirectory, moduleName, "mod.rs");

    if (await fileExists(leafFilePath)) {
        const isPair = await isModulePairRegistrationFile(leafFilePath);
        return {
            filePath: leafFilePath,
            registrationFilePath: isPair ? leafFilePath : undefined,
            layout: isPair ? "modern" : "leaf",
            childContainerPath: isPair ? path.join(sourceDirectory, moduleName) : undefined
        };
    }

    if (await fileExists(classicFilePath)) {
        return {
            filePath: classicFilePath,
            registrationFilePath: classicFilePath,
            layout: "classic",
            childContainerPath: path.dirname(classicFilePath)
        };
    }

    return {
        layout: "missing"
    };
}

async function collectCrateRootFiles(workspaceRootPath: string): Promise<string[]> {
    if (!await fileExists(workspaceRootPath)) {
        return [];
    }

    const crateRoots: string[] = [];

    async function walk(directory: string): Promise<void> {
        const entries = await fs.readdir(directory, { withFileTypes: true });

        for (const entry of entries) {
            const candidatePath = path.join(directory, entry.name);
            if (isBlacklistedPath(candidatePath)) {
                continue;
            }

            if (entry.isDirectory()) {
                await walk(candidatePath);
                continue;
            }

            if (entry.isFile() && (entry.name === "lib.rs" || entry.name === "main.rs")) {
                crateRoots.push(path.normalize(candidatePath));
            }
        }
    }

    await walk(workspaceRootPath);
    return crateRoots.sort();
}

async function readFileIfExists(filePath: string): Promise<string | null> {
    try {
        return await fs.readFile(filePath, "utf8");
    } catch {
        return null;
    }
}

function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, "/");
}
