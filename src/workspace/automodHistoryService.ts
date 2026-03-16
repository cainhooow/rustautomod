import { promises as fs } from "fs";
import { AutomodOperationBatch } from "../interfaces/automodoperation";

export class AutomodHistoryService {
    private readonly history: AutomodOperationBatch[] = [];

    push(batch: AutomodOperationBatch): void {
        if (batch.changes.length === 0) {
            return;
        }

        this.history.push(batch);
    }

    peek(): AutomodOperationBatch | undefined {
        return this.history[this.history.length - 1];
    }

    async undoLast(): Promise<AutomodOperationBatch | null> {
        const batch = this.history.pop();
        if (!batch) {
            return null;
        }

        for (const change of [...batch.changes].reverse()) {
            if (change.beforeContent === null) {
                await fs.rm(change.targetFilePath, { force: true });
                continue;
            }

            await fs.writeFile(change.targetFilePath, change.beforeContent, "utf8");
        }

        return batch;
    }
}
