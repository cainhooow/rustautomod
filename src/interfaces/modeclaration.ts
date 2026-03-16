import { AutomodVisibility } from "./automodconf";

export type ManagedDeclarationKind = "mod" | "pub_use";

export interface ModDeclaration {
    attributes: string[];
    modLine: string;
    fullBlock: string[];
    startIndex: number;
    endIndex: number;
}

export interface ManagedDeclaration {
    kind: ManagedDeclarationKind;
    attributes: string[];
    line: string;
    fullBlock: string[];
    startIndex: number;
    endIndex: number;
    moduleName: string;
    visibility?: AutomodVisibility;
    hasCfg: boolean;
}
