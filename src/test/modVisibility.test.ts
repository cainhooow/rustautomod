import * as assert from "assert";
import * as path from "path";
import {
    createDefaultWorkspaceModVisibilityState,
    isIndexLikeModRsContent,
    reconcileManagedExcludes,
    toRelativeExcludePattern
} from "../workbench/modVisibility";

suite("modVisibility", () => {
    suite("isIndexLikeModRsContent", () => {
        test("returns true for module declarations only", () => {
            const content = `pub mod api;
mod internal;
#[cfg(feature = "serde")]
pub mod serde_support;
`;

            assert.strictEqual(isIndexLikeModRsContent(content), true);
        });

        test("returns true for re-exports that behave like an index", () => {
            const content = `#[cfg(feature = "api")]
pub use self::api::{Client, Result};
pub use crate::prelude::*;
`;

            assert.strictEqual(isIndexLikeModRsContent(content), true);
        });

        test("returns false when the file contains real code", () => {
            const content = `pub mod api;

pub fn helper() {}
`;

            assert.strictEqual(isIndexLikeModRsContent(content), false);
        });

        test("returns false for inline modules with bodies", () => {
            const content = `pub mod api {
    pub fn helper() {}
}
`;

            assert.strictEqual(isIndexLikeModRsContent(content), false);
        });
    });

    suite("reconcileManagedExcludes", () => {
        test("removes only excludes managed by the extension", () => {
            const result = reconcileManagedExcludes(
                {
                    "src/old/mod.rs": true,
                    "**/*.generated.rs": true
                },
                ["src/new/mod.rs"],
                {
                    ...createDefaultWorkspaceModVisibilityState(),
                    lastAppliedExcludes: ["src/old/mod.rs"]
                }
            );

            assert.deepStrictEqual(result.excludes, {
                "src/new/mod.rs": true,
                "**/*.generated.rs": true
            });
        });

        test("keeps excludes that already existed before the extension managed them", () => {
            const currentExcludes = {
                "src/shared/mod.rs": true
            };

            const firstPass = reconcileManagedExcludes(
                currentExcludes,
                ["src/shared/mod.rs"],
                createDefaultWorkspaceModVisibilityState()
            );

            const secondPass = reconcileManagedExcludes(
                firstPass.excludes,
                [],
                {
                    ...createDefaultWorkspaceModVisibilityState(),
                    preservedExcludes: firstPass.preservedExcludes,
                    lastAppliedExcludes: firstPass.lastAppliedExcludes
                }
            );

            assert.deepStrictEqual(secondPass.excludes, currentExcludes);
        });
    });

    test("normalizes workspace-relative exclude patterns", () => {
        const workspacePath = path.join("C:", "repo");
        const filePath = path.join("C:", "repo", "src", "feature", "mod.rs");

        assert.strictEqual(
            toRelativeExcludePattern(workspacePath, filePath),
            "src/feature/mod.rs"
        );
    });
});
