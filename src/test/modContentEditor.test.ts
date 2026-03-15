import * as assert from "assert";
import { addModDeclarations, removeModDeclarations, sortModDeclarationsInContent } from "../automod/modContentEditor";

suite("modContentEditor", () => {
    test("adds a module after use statements", () => {
        const content = `use crate::shared::Result;

pub fn run() {}
`;

        const updated = addModDeclarations(content, ["pub mod api;"], "none");

        assert.strictEqual(
            updated,
            `use crate::shared::Result;

pub mod api;
pub fn run() {}
`
        );
    });

    test("sorts modules alphabetically when enabled", () => {
        const content = `pub mod zebra;
pub mod alpha;
`;

        const updated = addModDeclarations(content, ["pub mod middle;"], "alpha");

        assert.strictEqual(
            updated,
            `pub mod alpha;
pub mod middle;
pub mod zebra;
`
        );
    });

    test("removes every matching declaration block", () => {
        const content = `#[cfg(feature = "api")]
pub mod api;
pub mod helper;
`;

        const updated = removeModDeclarations(content, "api");

        assert.strictEqual(
            updated,
            `pub mod helper;
`
        );
    });

    test("sorts declarations without changing trailing newline semantics", () => {
        const content = `pub mod zebra;
pub mod alpha;`;

        const updated = sortModDeclarationsInContent(content);

        assert.strictEqual(
            updated,
            `pub mod alpha;
pub mod zebra;`
        );
    });
});
