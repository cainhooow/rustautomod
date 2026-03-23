use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::core::paths::is_blacklisted_path;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ModuleLayout {
    Classic,
    Modern,
}

pub fn is_special_rust_file(file_name: &str) -> bool {
    matches!(file_name, "mod" | "lib" | "main" | "build")
}

pub fn is_registration_target_file(path: &Path) -> bool {
    if path.extension().and_then(|value| value.to_str()) != Some("rs") {
        return false;
    }

    let base_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    if matches!(base_name, "mod.rs" | "lib.rs" | "main.rs") {
        return true;
    }

    path.parent()
        .map(|parent| parent.join(path.file_stem().unwrap_or_default()).is_dir())
        .unwrap_or(false)
}

pub fn detect_layout(folder_path: &Path) -> ModuleLayout {
    let sibling_modern = folder_path.parent().map(|parent| {
        parent.join(format!(
            "{}.rs",
            folder_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
        ))
    });

    if sibling_modern.as_ref().is_some_and(|path| path.exists()) {
        return ModuleLayout::Modern;
    }

    if folder_path.join("mod.rs").exists() {
        return ModuleLayout::Classic;
    }

    if let Some(parent_dir) = folder_path.parent() {
        let mut modern_count = 0usize;
        let mut classic_count = 0usize;

        if let Ok(entries) = fs::read_dir(parent_dir) {
            for entry in entries.flatten() {
                let sibling_path = entry.path();
                if !sibling_path.is_dir() || sibling_path == folder_path {
                    continue;
                }

                let Some(sibling_name) = sibling_path.file_name().and_then(|value| value.to_str())
                else {
                    continue;
                };

                if parent_dir.join(format!("{sibling_name}.rs")).exists() {
                    modern_count += 1;
                    continue;
                }

                if sibling_path.join("mod.rs").exists() {
                    classic_count += 1;
                }
            }
        }

        if modern_count > classic_count {
            return ModuleLayout::Modern;
        }

        if classic_count > 0 {
            return ModuleLayout::Classic;
        }
    }

    ModuleLayout::Classic
}

pub fn resolve_parent_registration_target(file_path: &Path) -> Option<PathBuf> {
    let container_dir = parent_container_dir_for_module_file(file_path)?;
    Some(resolve_registration_target(&container_dir))
}

pub fn resolve_existing_parent_registration_target(file_path: &Path) -> Option<PathBuf> {
    let container_dir = parent_container_dir_for_module_file(file_path)?;
    find_existing_registration_target(&container_dir)
}

pub fn resolve_registration_target(folder_path: &Path) -> PathBuf {
    let lib_path = folder_path.join("lib.rs");
    if lib_path.exists() {
        return lib_path;
    }

    let main_path = folder_path.join("main.rs");
    if main_path.exists() {
        return main_path;
    }

    match detect_layout(folder_path) {
        ModuleLayout::Modern => folder_path.parent().unwrap_or(folder_path).join(format!(
            "{}.rs",
            folder_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
        )),
        ModuleLayout::Classic => folder_path.join("mod.rs"),
    }
}

pub fn find_existing_registration_target(folder_path: &Path) -> Option<PathBuf> {
    let lib_path = folder_path.join("lib.rs");
    if lib_path.exists() {
        return Some(lib_path);
    }

    let main_path = folder_path.join("main.rs");
    if main_path.exists() {
        return Some(main_path);
    }

    let modern_target = folder_path.parent().map(|parent| {
        parent.join(format!(
            "{}.rs",
            folder_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
        ))
    });
    if modern_target.as_ref().is_some_and(|path| path.exists()) {
        return modern_target;
    }

    let classic_target = folder_path.join("mod.rs");
    if classic_target.exists() {
        return Some(classic_target);
    }

    None
}

pub fn source_directory_for_registration_target(target_path: &Path) -> Option<PathBuf> {
    let base_name = target_path.file_name().and_then(|value| value.to_str())?;
    match base_name {
        "mod.rs" | "lib.rs" | "main.rs" => target_path.parent().map(Path::to_path_buf),
        _ => {
            if target_path.extension().and_then(|value| value.to_str()) != Some("rs") {
                return None;
            }

            let sibling_dir = target_path
                .parent()
                .map(|parent| parent.join(target_path.file_stem().unwrap_or_default()))?;
            if sibling_dir.is_dir() {
                Some(sibling_dir)
            } else {
                None
            }
        }
    }
}

pub fn module_name_from_file_path(file_path: &Path) -> Option<String> {
    let base_name = file_path.file_name().and_then(|value| value.to_str())?;
    match base_name {
        "lib.rs" | "main.rs" => None,
        "mod.rs" => file_path
            .parent()
            .and_then(|value| value.file_name())
            .map(|value| value.to_string_lossy().to_string()),
        _ if file_path.extension().and_then(|value| value.to_str()) == Some("rs") => Some(
            file_path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string(),
        ),
        _ => None,
    }
}

pub fn child_module_entries_for_target(target_path: &Path) -> Vec<PathBuf> {
    let Some(child_dir) = source_directory_for_registration_target(target_path) else {
        return Vec::new();
    };

    collect_child_module_entries(&child_dir, Some(target_path))
}

pub fn collect_child_module_entries(
    root_dir: &Path,
    current_target: Option<&Path>,
) -> Vec<PathBuf> {
    if !root_dir.exists() {
        return Vec::new();
    }

    let mut child_entries = BTreeSet::new();
    let read_dir = match fs::read_dir(root_dir) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };

    for entry in read_dir.flatten() {
        let entry_path = entry.path();
        if is_blacklisted_path(&entry_path) {
            continue;
        }

        if entry_path.is_file() {
            if entry_path.extension().and_then(|value| value.to_str()) != Some("rs") {
                continue;
            }

            let stem = entry_path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("");
            if is_special_rust_file(stem) {
                continue;
            }

            if current_target
                .map(|target| target.canonicalize().ok() == entry_path.canonicalize().ok())
                .unwrap_or(false)
            {
                continue;
            }

            child_entries.insert(entry_path);
            continue;
        }

        if !entry_path.is_dir() {
            continue;
        }

        let module_name = entry_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        let modern_candidate = root_dir.join(format!("{module_name}.rs"));
        if modern_candidate.exists() {
            child_entries.insert(modern_candidate);
            continue;
        }

        let classic_candidate = entry_path.join("mod.rs");
        if classic_candidate.exists() || directory_contains_rust_sources(&entry_path) {
            child_entries.insert(classic_candidate);
        }
    }

    child_entries.into_iter().collect()
}

pub fn discover_sync_targets_under_dir(root_dir: &Path) -> Vec<PathBuf> {
    let mut targets = BTreeSet::new();

    for entry in walkdir::WalkDir::new(root_dir)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_dir())
    {
        let dir_path = entry.path().to_path_buf();
        if is_blacklisted_path(&dir_path) {
            continue;
        }

        if !collect_child_module_entries(&dir_path, None).is_empty() {
            if let Some(existing_target) = find_existing_registration_target(&dir_path) {
                targets.insert(existing_target);
            }
        }
    }

    targets.into_iter().collect()
}

fn directory_contains_rust_sources(dir_path: &Path) -> bool {
    let read_dir = match fs::read_dir(dir_path) {
        Ok(entries) => entries,
        Err(_) => return false,
    };

    read_dir.flatten().any(|entry| {
        entry.path().is_file()
            && entry.path().extension().and_then(|value| value.to_str()) == Some("rs")
            && !is_special_rust_file(
                entry
                    .path()
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .unwrap_or(""),
            )
    })
}

fn parent_container_dir_for_module_file(file_path: &Path) -> Option<PathBuf> {
    let base_name = file_path.file_name().and_then(|value| value.to_str())?;
    match base_name {
        "lib.rs" | "main.rs" => None,
        "mod.rs" => file_path
            .parent()
            .and_then(|parent| parent.parent())
            .map(Path::to_path_buf),
        _ => file_path.parent().map(Path::to_path_buf),
    }
}
