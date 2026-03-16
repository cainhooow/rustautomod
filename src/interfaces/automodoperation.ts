export interface AutomodFileChange {
    targetFilePath: string;
    beforeContent: string | null;
    afterContent: string | null;
    reason: string;
    formatAfterApply?: boolean;
}

export interface AutomodOperationBatch {
    label: string;
    sourcePath?: string;
    changes: AutomodFileChange[];
}
