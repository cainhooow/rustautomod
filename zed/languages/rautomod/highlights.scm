; Best-effort highlighting for .rautomod using the TOML grammar.

(comment) @comment
(bare_key) @property
(quoted_key) @property
(string) @string
(escape_sequence) @string.escape
(integer) @number
(float) @number
(boolean) @constant

"=" @operator

[
  "."
  ","
] @punctuation.delimiter

[
  "("
  ")"
] @punctuation.bracket
