use anyhow::{Context, Result};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::core::config::resolve_project_config;
use crate::core::config::Visibility;
use crate::core::declarations::{
    build_desired_declarations, parse_managed_declarations, rewrite_target_content,
    sort_desired_declarations, DeclarationKind, RewriteOptions,
};
use crate::core::modules::{child_module_entries_for_target, module_name_from_file_path};

#[derive(Clone, Debug)]
pub struct TargetSyncPlan {
    pub target_path: PathBuf,
    pub current_text: String,
    pub next_text: String,
    pub existed_before: bool,
    pub desired_modules: Vec<String>,
    pub missing_modules: Vec<String>,
}

impl TargetSyncPlan {
    pub fn changed(&self) -> bool {
        self.current_text != self.next_text
    }
}

pub fn build_target_sync_plan(
    target_path: &Path,
    current_text: Option<String>,
) -> Result<Option<TargetSyncPlan>> {
    let current_text = current_text.unwrap_or_default();
    let existing_declarations = parse_managed_declarations(&split_lines(&current_text));
    let inferred_visibility = infer_visibility_from_existing(&existing_declarations);
    let child_entries = child_module_entries_for_target(target_path);
    let mut desired = Vec::new();
    let mut desired_modules = BTreeSet::new();

    for child_path in child_entries {
        let Some(module_name) = module_name_from_file_path(&child_path) else {
            continue;
        };

        let resolved = resolve_project_config(&child_path)?;
        if resolved.ignored {
            continue;
        }

        let declaration_visibility = if resolved.rule.source_path.is_none() {
            inferred_visibility
                .clone()
                .unwrap_or_else(|| resolved.rule.visibility.clone())
        } else {
            resolved.rule.visibility.clone()
        };

        desired_modules.insert(module_name.clone());
        desired.extend(build_desired_declarations(
            &module_name,
            &declaration_visibility,
            &resolved.rule.cfg,
            &resolved.rule.reexport,
        ));
    }

    let target_resolved = resolve_project_config(target_path)?;
    let mut options = RewriteOptions {
        sort: target_resolved.rule.sort,
        group_order: target_resolved.rule.group_order,
        blank_lines: target_resolved.rule.blank_lines,
        header: target_resolved.rule.header,
        generated_comment: target_resolved.rule.generated_comment,
    };

    sort_desired_declarations(&mut desired, &options);

    if desired.is_empty() {
        options.header = None;
        options.generated_comment = None;
    }

    let existed_before = !current_text.is_empty() || target_path.exists();
    let next_text = rewrite_target_content(&current_text, &desired, &options);

    if !existed_before && next_text.trim().is_empty() {
        return Ok(None);
    }

    let declared_modules = declared_module_names(&current_text, DeclarationKind::Mod);
    let missing_modules = desired_modules
        .iter()
        .filter(|module_name| !declared_modules.contains(*module_name))
        .cloned()
        .collect::<Vec<_>>();

    let desired_modules = desired_modules.into_iter().collect::<Vec<_>>();
    if !existed_before && desired_modules.is_empty() {
        return Ok(None);
    }

    Ok(Some(TargetSyncPlan {
        target_path: target_path.to_path_buf(),
        current_text,
        next_text,
        existed_before,
        desired_modules,
        missing_modules,
    }))
}

pub fn read_target_text(target_path: &Path) -> Result<Option<String>> {
    if !target_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(target_path)
        .with_context(|| format!("failed to read {}", target_path.display()))?;
    Ok(Some(content))
}

pub fn apply_target_sync_plan(plan: &TargetSyncPlan) -> Result<bool> {
    if !plan.changed() {
        return Ok(false);
    }

    if let Some(parent_dir) = plan.target_path.parent() {
        fs::create_dir_all(parent_dir)
            .with_context(|| format!("failed to create {}", parent_dir.display()))?;
    }

    fs::write(&plan.target_path, &plan.next_text)
        .with_context(|| format!("failed to write {}", plan.target_path.display()))?;
    Ok(true)
}

pub fn declared_module_names(current_text: &str, kind: DeclarationKind) -> BTreeSet<String> {
    parse_managed_declarations(&split_lines(current_text))
        .into_iter()
        .filter(|declaration| declaration.kind == kind)
        .map(|declaration| declaration.module_name)
        .collect()
}

fn split_lines(content: &str) -> Vec<String> {
    content
        .replace("\r\n", "\n")
        .split('\n')
        .map(ToString::to_string)
        .collect()
}

fn infer_visibility_from_existing(
    existing_declarations: &[crate::core::declarations::ManagedDeclaration],
) -> Option<Visibility> {
    existing_declarations
        .iter()
        .find(|declaration| declaration.kind == DeclarationKind::Mod)
        .and_then(|declaration| declaration.visibility.clone())
}
