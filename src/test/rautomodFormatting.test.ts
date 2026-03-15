import * as assert from "assert";
import { formatRautomod } from "../linting/rautomodFormatter";

suite("rautomodFormatting", () => {
    test("normalizes assignments and blank lines", () => {
        const input = `visibility = pub


sort = alpha   
fmt = enabled`;

        assert.strictEqual(
            formatRautomod(input),
            `visibility=pub

sort=alpha
fmt=enabled
`
        );
    });

    test("formats pattern and cfg lists", () => {
        const input = `pattern = utils, helpers ,internal
cfg = feature="serde", all(unix, target_pointer_width = "64")`;

        assert.strictEqual(
            formatRautomod(input),
            `pattern=utils,helpers,internal
cfg=feature="serde",all(unix, target_pointer_width = "64")
`
        );
    });

    test("preserves comments while trimming comment indentation", () => {
        const input = `  # comment
visibility = private`;

        assert.strictEqual(
            formatRautomod(input),
            `# comment
visibility=private
`
        );
    });
});
