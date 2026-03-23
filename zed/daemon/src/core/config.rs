use anyhow::{Context, Result};
use regex::Regex;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::core::paths::normalize_separators;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Visibility {
    Public,
    Private,
    PubCrate,
    PubSuper,
}

impl Visibility {
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "pub" => Some(Self::Public),
            "private" => Some(Self::Private),
            "pub(crate)" => Some(Self::PubCrate),
            "pub(super)" => Some(Self::PubSuper),
            _ => None,
        }
    }

    pub fn as_decl_prefix(&self) -> &'static str {
        match self {
            Self::Public => "pub",
            Self::Private => "",
            Self::PubCrate => "pub(crate)",
            Self::PubSuper => "pub(super)",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SortMode {
    Alpha,
    AlphaCaseInsensitive,
    None,
    PubFirst,
    CfgFirst,
}

impl SortMode {
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "alpha" => Some(Self::Alpha),
            "alpha_case_insensitive" => Some(Self::AlphaCaseInsensitive),
            "none" => Some(Self::None),
            "pub_first" => Some(Self::PubFirst),
            "cfg_first" => Some(Self::CfgFirst),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TargetMode {
    Auto,
    ModRs,
    LibRs,
    MainRs,
}

impl TargetMode {
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "auto" => Some(Self::Auto),
            "mod.rs" => Some(Self::ModRs),
            "lib.rs" => Some(Self::LibRs),
            "main.rs" => Some(Self::MainRs),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Copy)]
pub enum GroupOrder {
    Use,
    Cfg,
    PubMod,
    Mod,
    PubUse,
}

impl GroupOrder {
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "use" => Some(Self::Use),
            "cfg" => Some(Self::Cfg),
            "pub_mod" => Some(Self::PubMod),
            "mod" => Some(Self::Mod),
            "pub_use" => Some(Self::PubUse),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReexportMode {
    Enabled,
    Disabled,
}

impl ReexportMode {
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "enabled" => Some(Self::Enabled),
            "disabled" => Some(Self::Disabled),
            _ => None,
        }
    }
}

#[derive(Clone, Debug)]
pub struct AutomodRule {
    pub visibility: Visibility,
    pub sort: SortMode,
    pub target: TargetMode,
    pub pattern: Vec<String>,
    pub exclude: Vec<String>,
    pub cfg: Vec<String>,
    pub group_order: Vec<GroupOrder>,
    pub blank_lines: usize,
    pub reexport: ReexportMode,
    pub header: Option<String>,
    pub generated_comment: Option<String>,
    pub source_path: Option<PathBuf>,
}

impl Default for AutomodRule {
    fn default() -> Self {
        Self {
            visibility: Visibility::Public,
            sort: SortMode::Alpha,
            target: TargetMode::Auto,
            pattern: Vec::new(),
            exclude: Vec::new(),
            cfg: Vec::new(),
            group_order: default_group_order(),
            blank_lines: 1,
            reexport: ReexportMode::Disabled,
            header: None,
            generated_comment: None,
            source_path: None,
        }
    }
}

#[derive(Clone, Debug)]
pub struct ConfigDocument {
    pub rules: Vec<AutomodRule>,
}

#[derive(Clone, Debug)]
pub struct ResolvedConfig {
    pub rule: AutomodRule,
    pub ignored: bool,
}

pub fn default_group_order() -> Vec<GroupOrder> {
    vec![
        GroupOrder::Use,
        GroupOrder::Cfg,
        GroupOrder::PubMod,
        GroupOrder::Mod,
        GroupOrder::PubUse,
    ]
}

pub fn resolve_project_config(file_path: &Path) -> Result<ResolvedConfig> {
    for config_path in candidate_config_paths(file_path) {
        if !config_path.exists() {
            continue;
        }

        let document = load_config_document(&config_path, &mut HashSet::new())?;
        if let Some(resolved) = resolve_from_document(&document, file_path)? {
            return Ok(resolved);
        }
    }

    Ok(ResolvedConfig {
        rule: AutomodRule::default(),
        ignored: false,
    })
}

pub fn nearest_config_path(file_path: &Path) -> Option<PathBuf> {
    candidate_config_paths(file_path)
        .into_iter()
        .find(|config_path| config_path.exists())
}

fn resolve_from_document(
    document: &ConfigDocument,
    file_path: &Path,
) -> Result<Option<ResolvedConfig>> {
    for rule in &document.rules {
        let evaluation = evaluate_rule(rule, file_path)?;
        if evaluation.matched {
            return Ok(Some(ResolvedConfig {
                rule: rule.clone(),
                ignored: evaluation.ignored,
            }));
        }
    }

    Ok(None)
}

fn load_config_document(
    config_path: &Path,
    visited: &mut HashSet<PathBuf>,
) -> Result<ConfigDocument> {
    let normalized = config_path
        .canonicalize()
        .unwrap_or_else(|_| config_path.to_path_buf());
    if !visited.insert(normalized) {
        return Ok(ConfigDocument { rules: Vec::new() });
    }

    let content = fs::read_to_string(config_path)
        .with_context(|| format!("failed to read {}", config_path.display()))?;
    let parsed = parse_document(&content, config_path);

    let mut merged_rules = parsed.rules.clone();
    for extends_path in parsed.extends_paths {
        let resolved = if Path::new(&extends_path).is_absolute() {
            PathBuf::from(&extends_path)
        } else {
            config_path
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .join(extends_path)
        };

        if !resolved.exists() {
            continue;
        }

        let document = load_config_document(&resolved, visited)?;
        merged_rules.extend(document.rules);
    }

    Ok(ConfigDocument {
        rules: merged_rules,
    })
}

struct ParsedDocument {
    rules: Vec<AutomodRule>,
    extends_paths: Vec<String>,
}

fn parse_document(content: &str, source_path: &Path) -> ParsedDocument {
    let mut rules = Vec::new();
    let mut extends_paths = Vec::new();
    let mut current_rule = AutomodRule {
        source_path: Some(source_path.to_path_buf()),
        ..AutomodRule::default()
    };
    let mut has_rule_content = false;

    let flush_rule = |rules: &mut Vec<AutomodRule>,
                      current_rule: &mut AutomodRule,
                      has_rule_content: &mut bool| {
        if !*has_rule_content {
            *current_rule = AutomodRule {
                source_path: current_rule.source_path.clone(),
                ..AutomodRule::default()
            };
            return;
        }

        rules.push(current_rule.clone());
        *current_rule = AutomodRule {
            source_path: current_rule.source_path.clone(),
            ..AutomodRule::default()
        };
        *has_rule_content = false;
    };

    for raw_line in content.replace("\r\n", "\n").split('\n') {
        let trimmed = raw_line.trim();
        if trimmed.is_empty() {
            flush_rule(&mut rules, &mut current_rule, &mut has_rule_content);
            continue;
        }

        if trimmed.starts_with('#') {
            continue;
        }

        let Some(separator_index) = trimmed.find('=') else {
            continue;
        };

        let key = trimmed[..separator_index].trim();
        let raw_value = trimmed[separator_index + 1..].trim();

        match key {
            "extends" => extends_paths.extend(split_simple_list(raw_value)),
            "visibility" => {
                if let Some(visibility) = Visibility::from_str(raw_value) {
                    current_rule.visibility = visibility;
                    has_rule_content = true;
                }
            }
            "sort" => {
                if let Some(sort) = SortMode::from_str(raw_value) {
                    current_rule.sort = sort;
                    has_rule_content = true;
                }
            }
            "target" => {
                if let Some(target) = TargetMode::from_str(raw_value) {
                    current_rule.target = target;
                    has_rule_content = true;
                }
            }
            "pattern" => {
                current_rule.pattern = split_simple_list(raw_value);
                has_rule_content = true;
            }
            "exclude" => {
                current_rule.exclude = split_simple_list(raw_value);
                has_rule_content = true;
            }
            "cfg" => {
                current_rule.cfg = smart_split_cfg(raw_value);
                has_rule_content = true;
            }
            "group_order" => {
                let group_order = split_simple_list(raw_value)
                    .into_iter()
                    .filter_map(|value| GroupOrder::from_str(&value))
                    .collect::<Vec<_>>();
                current_rule.group_order = if group_order.is_empty() {
                    default_group_order()
                } else {
                    group_order
                };
                has_rule_content = true;
            }
            "blank_lines" => {
                if let Ok(blank_lines) = raw_value.parse::<usize>() {
                    current_rule.blank_lines = blank_lines;
                    has_rule_content = true;
                }
            }
            "reexport" => {
                if let Some(reexport) = ReexportMode::from_str(raw_value) {
                    current_rule.reexport = reexport;
                    has_rule_content = true;
                }
            }
            "header" => {
                current_rule.header = if raw_value.is_empty() {
                    None
                } else {
                    Some(raw_value.to_string())
                };
                has_rule_content = true;
            }
            "generated_comment" => {
                current_rule.generated_comment = if raw_value.is_empty() {
                    None
                } else {
                    Some(raw_value.to_string())
                };
                has_rule_content = true;
            }
            _ => {}
        }
    }

    flush_rule(&mut rules, &mut current_rule, &mut has_rule_content);

    ParsedDocument {
        rules,
        extends_paths,
    }
}

struct RuleEvaluation {
    matched: bool,
    ignored: bool,
}

fn evaluate_rule(rule: &AutomodRule, file_path: &Path) -> Result<RuleEvaluation> {
    let normalized_path = normalize_separators(file_path.to_string_lossy());
    let file_name = file_path
        .file_name()
        .map(|value| normalize_separators(value.to_string_lossy()))
        .unwrap_or_default();
    let source_dir = rule
        .source_path
        .as_ref()
        .and_then(|path| path.parent().map(|value| value.to_path_buf()))
        .unwrap_or_else(|| {
            file_path
                .parent()
                .unwrap_or_else(|| Path::new(""))
                .to_path_buf()
        });
    let relative_path = normalize_separators(
        file_path
            .strip_prefix(&source_dir)
            .unwrap_or(file_path)
            .to_string_lossy(),
    );
    let candidates = vec![normalized_path, relative_path, file_name];

    let negative_patterns = rule
        .pattern
        .iter()
        .filter(|value| value.starts_with('!'))
        .map(|value| value.trim_start_matches('!').trim().to_string())
        .collect::<Vec<_>>();
    let positive_patterns = rule
        .pattern
        .iter()
        .filter(|value| !value.starts_with('!'))
        .cloned()
        .collect::<Vec<_>>();

    if negative_patterns
        .iter()
        .any(|pattern| pattern_matches(pattern, &candidates))
    {
        return Ok(RuleEvaluation {
            matched: false,
            ignored: false,
        });
    }

    let ignored = rule
        .exclude
        .iter()
        .any(|pattern| pattern_matches(pattern, &candidates));

    if positive_patterns.is_empty() {
        return Ok(RuleEvaluation {
            matched: true,
            ignored,
        });
    }

    Ok(RuleEvaluation {
        matched: positive_patterns
            .iter()
            .any(|pattern| pattern_matches(pattern, &candidates)),
        ignored,
    })
}

fn pattern_matches(pattern: &str, candidates: &[String]) -> bool {
    let normalized_pattern = normalize_separators(pattern)
        .trim_start_matches("./")
        .to_string();
    if normalized_pattern.is_empty() {
        return false;
    }

    let regex = glob_to_regex(&normalized_pattern);
    candidates.iter().any(|candidate| {
        let normalized_candidate = normalize_separators(candidate);
        regex.is_match(&normalized_candidate)
            || normalized_candidate.contains(&normalized_pattern)
            || Path::new(&normalized_candidate)
                .file_name()
                .map(|value| value.to_string_lossy() == normalized_pattern)
                .unwrap_or(false)
    })
}

fn glob_to_regex(pattern: &str) -> Regex {
    let escaped = regex::escape(pattern);
    let regex_body = escaped
        .replace("\\*\\*", ".*")
        .replace("\\*", "[^/]*")
        .replace("\\?", ".");
    Regex::new(&format!("(^|/){regex_body}$")).expect("valid generated regex")
}

fn candidate_config_paths(file_path: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let mut current_dir = file_path
        .parent()
        .unwrap_or_else(|| Path::new(""))
        .to_path_buf();

    loop {
        candidates.push(current_dir.join(".rautomod"));
        let Some(parent) = current_dir.parent() else {
            break;
        };
        if parent == current_dir {
            break;
        }
        current_dir = parent.to_path_buf();
    }

    candidates
}

fn split_simple_list(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(|entry| entry.trim().to_string())
        .filter(|entry| !entry.is_empty())
        .collect()
}

fn smart_split_cfg(value: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut depth = 0usize;

    for character in value.chars() {
        match character {
            '(' => {
                depth += 1;
                current.push(character);
            }
            ')' => {
                depth = depth.saturating_sub(1);
                current.push(character);
            }
            ',' if depth == 0 => {
                let trimmed = current.trim();
                if !trimmed.is_empty() {
                    parts.push(trimmed.to_string());
                }
                current.clear();
            }
            _ => current.push(character),
        }
    }

    let trimmed = current.trim();
    if !trimmed.is_empty() {
        parts.push(trimmed.to_string());
    }

    parts
}
