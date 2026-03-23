use std::path::{Path, PathBuf};

const BLACKLISTED_DIRS: &[&str] = &[
    ".git",
    "target",
    "node_modules",
    ".vscode",
    ".idea",
    "out",
    "dist",
    "build",
    ".cargo",
    ".rustup",
    "deps",
    "incremental",
];

pub fn normalize_separators(value: impl AsRef<str>) -> String {
    value.as_ref().replace('\\', "/")
}

pub fn is_blacklisted_path(path: &Path) -> bool {
    let normalized = normalize_separators(path.to_string_lossy());
    normalized.split('/').any(|part| {
        BLACKLISTED_DIRS.contains(&part) || (part.starts_with('.') && part != ".rautomod")
    })
}

pub fn path_within(root: &Path, candidate: &Path) -> bool {
    let normalized_root = root.components().collect::<Vec<_>>();
    let normalized_candidate = candidate.components().collect::<Vec<_>>();
    normalized_candidate.starts_with(&normalized_root)
}

pub fn normalize_path_buf(path: &Path) -> PathBuf {
    PathBuf::from(normalize_separators(path.to_string_lossy()))
}
