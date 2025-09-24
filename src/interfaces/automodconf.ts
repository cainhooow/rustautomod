export interface AutomodRule {
    visibility: "pub" | "private";
    sort: "alpha" | "none";
    pattern?: string[];
    cfg?: string[];
    fmt?: "enabled" | "disabled"
}