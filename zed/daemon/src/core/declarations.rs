use regex::Regex;
use std::collections::HashMap;

use crate::core::config::{default_group_order, GroupOrder, ReexportMode, SortMode, Visibility};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum DeclarationKind {
    Mod,
    PubUse,
}

#[derive(Clone, Debug)]
pub struct ManagedDeclaration {
    pub kind: DeclarationKind,
    pub module_name: String,
    pub visibility: Option<Visibility>,
    pub has_cfg: bool,
    pub full_block: Vec<String>,
    pub start_line: usize,
    pub end_line: usize,
}

#[derive(Clone, Debug)]
pub struct DesiredDeclaration {
    pub kind: DeclarationKind,
    pub module_name: String,
    pub visibility: Option<Visibility>,
    pub has_cfg: bool,
    pub lines: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct RewriteOptions {
    pub sort: SortMode,
    pub group_order: Vec<GroupOrder>,
    pub blank_lines: usize,
    pub header: Option<String>,
    pub generated_comment: Option<String>,
}

impl Default for RewriteOptions {
    fn default() -> Self {
        Self {
            sort: SortMode::Alpha,
            group_order: default_group_order(),
            blank_lines: 1,
            header: None,
            generated_comment: None,
        }
    }
}

pub fn parse_managed_declarations(lines: &[String]) -> Vec<ManagedDeclaration> {
    let mod_regex = Regex::new(r"^(?:pub(?:\((?:crate|super)\))?\s+)?mod\s+(\w+)\s*;$").unwrap();
    let reexport_regex = Regex::new(r"^pub\s+use\s+self::(\w+)::\*\s*;$").unwrap();
    let mut declarations = Vec::new();

    for (index, raw_line) in lines.iter().enumerate() {
        let line = raw_line.trim();
        if line.is_empty() || line.contains('{') {
            continue;
        }

        if let Some(captures) = mod_regex.captures(line) {
            let module_name = captures
                .get(1)
                .map(|value| value.as_str())
                .unwrap_or("")
                .to_string();
            let (start_line, full_block) = declaration_block(lines, index);
            let has_cfg = block_has_cfg_attributes(&full_block);
            declarations.push(ManagedDeclaration {
                kind: DeclarationKind::Mod,
                module_name,
                visibility: Some(extract_visibility(line)),
                has_cfg,
                full_block,
                start_line,
                end_line: index,
            });
            continue;
        }

        if let Some(captures) = reexport_regex.captures(line) {
            let module_name = captures
                .get(1)
                .map(|value| value.as_str())
                .unwrap_or("")
                .to_string();
            let (start_line, full_block) = declaration_block(lines, index);
            let has_cfg = block_has_cfg_attributes(&full_block);
            declarations.push(ManagedDeclaration {
                kind: DeclarationKind::PubUse,
                module_name,
                visibility: None,
                has_cfg,
                full_block,
                start_line,
                end_line: index,
            });
        }
    }

    declarations
}

pub fn rewrite_target_content(
    current_text: &str,
    declarations: &[DesiredDeclaration],
    options: &RewriteOptions,
) -> String {
    let lines = split_lines(current_text);
    let existing = parse_managed_declarations(&lines);
    let existing_map = existing
        .iter()
        .cloned()
        .map(|declaration| {
            (
                (declaration.kind, declaration.module_name.clone()),
                declaration,
            )
        })
        .collect::<HashMap<_, _>>();

    let generated_comment_line = options
        .generated_comment
        .as_ref()
        .and_then(|value| comment_line(value));
    let mut lines =
        filter_out_managed_declarations(lines, &existing, generated_comment_line.as_deref());

    let insertion_index = find_insertion_point(&lines, &options.group_order);
    let mut managed_lines = build_managed_lines(
        declarations,
        &existing_map,
        options,
        generated_comment_line.as_deref(),
    );
    let managed_line_count = managed_lines.len();
    lines.splice(insertion_index..insertion_index, managed_lines.drain(..));
    maybe_insert_spacing_after_managed_block(&mut lines, insertion_index, managed_line_count);
    lines = normalize_line_spacing(lines, options.blank_lines.max(1));

    let mut rewritten = join_lines(lines);
    rewritten = maybe_add_header(&rewritten, options.header.as_deref());
    cleanup_empty_lines(&rewritten)
}

pub fn build_desired_declarations(
    module_name: &str,
    visibility: &Visibility,
    cfg_values: &[String],
    reexport: &ReexportMode,
) -> Vec<DesiredDeclaration> {
    let mut declarations = vec![DesiredDeclaration {
        kind: DeclarationKind::Mod,
        module_name: module_name.to_string(),
        visibility: Some(visibility.clone()),
        has_cfg: !cfg_values.is_empty(),
        lines: attributed_lines(cfg_values, module_line(module_name, visibility)),
    }];

    if matches!(reexport, ReexportMode::Enabled) {
        declarations.push(DesiredDeclaration {
            kind: DeclarationKind::PubUse,
            module_name: module_name.to_string(),
            visibility: None,
            has_cfg: !cfg_values.is_empty(),
            lines: attributed_lines(cfg_values, format!("pub use self::{module_name}::*;")),
        });
    }

    declarations
}

pub fn sort_desired_declarations(
    declarations: &mut [DesiredDeclaration],
    options: &RewriteOptions,
) {
    let group_order = if options.group_order.is_empty() {
        default_group_order()
    } else {
        options.group_order.clone()
    };
    let group_positions = group_order
        .iter()
        .enumerate()
        .map(|(index, group)| (*group, index))
        .collect::<HashMap<_, _>>();

    declarations.sort_by(|left, right| {
        let left_group = declaration_group(left);
        let right_group = declaration_group(right);
        let left_group_pos = group_positions
            .get(&left_group)
            .copied()
            .unwrap_or(usize::MAX);
        let right_group_pos = group_positions
            .get(&right_group)
            .copied()
            .unwrap_or(usize::MAX);

        if left_group_pos != right_group_pos {
            return left_group_pos.cmp(&right_group_pos);
        }

        match options.sort {
            SortMode::None => std::cmp::Ordering::Equal,
            SortMode::Alpha => left.module_name.cmp(&right.module_name),
            SortMode::AlphaCaseInsensitive => left
                .module_name
                .to_lowercase()
                .cmp(&right.module_name.to_lowercase())
                .then_with(|| left.module_name.cmp(&right.module_name)),
            SortMode::PubFirst => declaration_visibility_weight(left)
                .cmp(&declaration_visibility_weight(right))
                .then_with(|| left.module_name.cmp(&right.module_name)),
            SortMode::CfgFirst => declaration_cfg_weight(left)
                .cmp(&declaration_cfg_weight(right))
                .then_with(|| left.module_name.cmp(&right.module_name)),
        }
    });
}

fn declaration_group(declaration: &DesiredDeclaration) -> GroupOrder {
    match declaration.kind {
        DeclarationKind::PubUse => GroupOrder::PubUse,
        DeclarationKind::Mod if declaration.has_cfg => GroupOrder::Cfg,
        DeclarationKind::Mod => match declaration.visibility {
            Some(Visibility::Private) => GroupOrder::Mod,
            _ => GroupOrder::PubMod,
        },
    }
}

fn existing_declaration_group(declaration: &ManagedDeclaration) -> GroupOrder {
    match declaration.kind {
        DeclarationKind::PubUse => GroupOrder::PubUse,
        DeclarationKind::Mod if declaration.has_cfg => GroupOrder::Cfg,
        DeclarationKind::Mod => match declaration.visibility {
            Some(Visibility::Private) => GroupOrder::Mod,
            _ => GroupOrder::PubMod,
        },
    }
}

fn declaration_visibility_weight(declaration: &DesiredDeclaration) -> usize {
    match declaration.visibility {
        Some(Visibility::Private) => 1,
        _ => 0,
    }
}

fn declaration_cfg_weight(declaration: &DesiredDeclaration) -> usize {
    if declaration.has_cfg {
        0
    } else {
        1
    }
}

fn attribute_block_start(lines: &[String], index: usize) -> usize {
    let mut cursor = index;
    while cursor > 0 {
        let previous = lines[cursor - 1].trim();
        if previous.starts_with("#[") {
            cursor -= 1;
            continue;
        }
        break;
    }

    cursor
}

fn declaration_block(lines: &[String], index: usize) -> (usize, Vec<String>) {
    let start = attribute_block_start(lines, index);
    let mut block = Vec::new();
    for line in lines.iter().take(index + 1).skip(start) {
        block.push(line.clone());
    }

    (start, block)
}

fn extract_visibility(line: &str) -> Visibility {
    if line.starts_with("pub(crate) mod ") {
        Visibility::PubCrate
    } else if line.starts_with("pub(super) mod ") {
        Visibility::PubSuper
    } else if line.starts_with("pub mod ") {
        Visibility::Public
    } else {
        Visibility::Private
    }
}

fn block_has_cfg_attributes(full_block: &[String]) -> bool {
    full_block
        .iter()
        .take(full_block.len().saturating_sub(1))
        .any(|line| line.trim().starts_with("#["))
}

fn attributed_lines(cfg_values: &[String], line: String) -> Vec<String> {
    if cfg_values.is_empty() {
        return vec![line];
    }

    let mut lines = Vec::new();
    for cfg_value in cfg_values {
        let trimmed = cfg_value.trim();
        if trimmed.starts_with("#[cfg(") && trimmed.ends_with(")]") {
            lines.push(trimmed.to_string());
        } else {
            lines.push(format!("#[cfg({trimmed})]"));
        }
    }
    lines.push(line);
    lines
}

fn module_line(module_name: &str, visibility: &Visibility) -> String {
    match visibility {
        Visibility::Private => format!("mod {module_name};"),
        _ => format!("{} mod {module_name};", visibility.as_decl_prefix()),
    }
}

fn build_managed_lines(
    declarations: &[DesiredDeclaration],
    existing_map: &HashMap<(DeclarationKind, String), ManagedDeclaration>,
    options: &RewriteOptions,
    generated_comment_line: Option<&str>,
) -> Vec<String> {
    let mut lines = Vec::new();
    let mut previous_group: Option<GroupOrder> = None;
    let mut rendered_blocks = Vec::new();

    for declaration in declarations {
        let key = (declaration.kind, declaration.module_name.clone());
        if let Some(existing) = existing_map.get(&key) {
            rendered_blocks.push(RenderedDeclaration {
                group: existing_declaration_group(existing),
                lines: existing.full_block.clone(),
            });
        } else {
            rendered_blocks.push(RenderedDeclaration {
                group: declaration_group(declaration),
                lines: declaration.lines.clone(),
            });
        }
    }

    if let Some(generated_comment_line) =
        generated_comment_line.filter(|_| !rendered_blocks.is_empty())
    {
        lines.push(generated_comment_line.to_string());
    }

    for declaration in rendered_blocks {
        let group = declaration.group;
        if previous_group.is_some() && previous_group != Some(group) {
            push_blank_lines(&mut lines, options.blank_lines);
        }

        lines.extend(declaration.lines);
        previous_group = Some(group);
    }

    lines
}

#[derive(Clone, Debug)]
struct RenderedDeclaration {
    group: GroupOrder,
    lines: Vec<String>,
}

fn filter_out_managed_declarations(
    mut lines: Vec<String>,
    declarations: &[ManagedDeclaration],
    generated_comment_line: Option<&str>,
) -> Vec<String> {
    let mut ranges = declarations
        .iter()
        .map(|declaration| (declaration.start_line, declaration.end_line))
        .collect::<Vec<_>>();
    ranges.sort_by(|left, right| right.0.cmp(&left.0));

    for (start, end) in ranges {
        let remove_count = end.saturating_sub(start) + 1;
        lines.drain(start..start + remove_count);
    }

    lines.retain(|line| !is_automod_comment_line(line, generated_comment_line));

    while lines.first().is_some_and(|line| line.trim().is_empty()) {
        lines.remove(0);
    }

    while lines.last().is_some_and(|line| line.trim().is_empty()) {
        lines.pop();
    }

    lines
}

fn find_insertion_point(lines: &[String], group_order: &[GroupOrder]) -> usize {
    let mut after_header_index = 0usize;
    while after_header_index < lines.len() {
        let trimmed = lines[after_header_index].trim();
        if trimmed.starts_with("//!")
            || trimmed.starts_with("/*!")
            || trimmed.starts_with("#!")
            || trimmed.is_empty()
        {
            after_header_index += 1;
            continue;
        }
        break;
    }

    let use_block = find_use_block(lines, after_header_index);
    if use_block.end < 0 {
        return after_header_index;
    }

    let effective_group_order = if group_order.is_empty() {
        default_group_order()
    } else {
        group_order.to_vec()
    };
    let use_order = effective_group_order
        .iter()
        .position(|group| matches!(group, GroupOrder::Use))
        .unwrap_or(usize::MAX);
    let first_managed_order = effective_group_order
        .iter()
        .enumerate()
        .filter(|(_, group)| !matches!(group, GroupOrder::Use))
        .map(|(index, _)| index)
        .min()
        .unwrap_or(usize::MAX);

    if use_order <= first_managed_order {
        let mut insert_index = (use_block.end as usize) + 1;
        while insert_index < lines.len() && lines[insert_index].trim().is_empty() {
            insert_index += 1;
        }
        insert_index
    } else {
        use_block.start.max(0) as usize
    }
}

#[derive(Clone, Copy, Debug)]
struct UseBlock {
    start: isize,
    end: isize,
}

fn find_use_block(lines: &[String], after_header_index: usize) -> UseBlock {
    let mut start: isize = -1;
    let mut end: isize = -1;
    let mut brace_depth = 0isize;
    let mut in_use_statement = false;

    for (index, raw_line) in lines.iter().enumerate().skip(after_header_index) {
        let trimmed = raw_line.trim();

        if trimmed.starts_with("use ") {
            if start == -1 {
                start = index as isize;
            }

            in_use_statement = true;
            brace_depth = 0;
            update_brace_depth(trimmed, &mut brace_depth);

            if trimmed.ends_with(';') && brace_depth == 0 {
                end = index as isize;
                in_use_statement = false;
            }

            continue;
        }

        if in_use_statement {
            update_brace_depth(trimmed, &mut brace_depth);
            if trimmed.ends_with(';') && brace_depth == 0 {
                end = index as isize;
                in_use_statement = false;
            }
            continue;
        }

        if !trimmed.is_empty() && !trimmed.starts_with("//") && !trimmed.starts_with("/*") {
            break;
        }
    }

    UseBlock { start, end }
}

fn update_brace_depth(line: &str, brace_depth: &mut isize) {
    for character in line.chars() {
        if character == '{' {
            *brace_depth += 1;
        } else if character == '}' {
            *brace_depth -= 1;
        }
    }
}

fn maybe_add_header(content: &str, header: Option<&str>) -> String {
    let Some(header) = header else {
        return content.to_string();
    };
    let Some(header_line) = comment_line(header) else {
        return content.to_string();
    };

    if content.starts_with(&format!("{header_line}\n")) || content.trim() == header_line {
        return content.to_string();
    }

    if content.trim().is_empty() {
        return format!("{header_line}\n");
    }

    format!("{header_line}\n{content}")
}

fn comment_line(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    if trimmed.starts_with("//") {
        Some(trimmed.to_string())
    } else {
        Some(format!("// {trimmed}"))
    }
}

fn is_automod_comment_line(line: &str, generated_comment_line: Option<&str>) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return false;
    }

    if generated_comment_line.is_some_and(|comment_line| trimmed == comment_line) {
        return true;
    }

    matches!(
        trimmed,
        "// rustautomod" | "// managed by rustautomod" | "// generated by rustautomod"
    )
}

fn push_blank_lines(lines: &mut Vec<String>, count: usize) {
    for _ in 0..count {
        if lines.last().map(|line| line.is_empty()).unwrap_or(false) {
            continue;
        }
        lines.push(String::new());
    }
}

fn split_lines(content: &str) -> Vec<String> {
    content
        .replace("\r\n", "\n")
        .split('\n')
        .map(ToString::to_string)
        .collect()
}

fn join_lines(lines: Vec<String>) -> String {
    lines.join("\n")
}

fn normalize_line_spacing(lines: Vec<String>, max_consecutive_blank_lines: usize) -> Vec<String> {
    let mut normalized = Vec::with_capacity(lines.len());
    let mut blank_run = 0usize;

    for line in lines {
        let trimmed_end = line.trim_end().to_string();
        if trimmed_end.trim().is_empty() {
            blank_run += 1;
            if blank_run > max_consecutive_blank_lines {
                continue;
            }

            normalized.push(String::new());
            continue;
        }

        blank_run = 0;
        normalized.push(trimmed_end);
    }

    normalized
}

fn maybe_insert_spacing_after_managed_block(
    lines: &mut Vec<String>,
    insertion_index: usize,
    managed_line_count: usize,
) {
    if managed_line_count == 0 {
        return;
    }

    let trailing_index = insertion_index + managed_line_count;
    if trailing_index >= lines.len() {
        return;
    }

    if lines[trailing_index].trim().is_empty() {
        return;
    }

    let has_following_content = lines[trailing_index..]
        .iter()
        .any(|line| !line.trim().is_empty());
    if !has_following_content {
        return;
    }

    lines.insert(trailing_index, String::new());
}

fn cleanup_empty_lines(content: &str) -> String {
    let mut lines = split_lines(content);
    while lines
        .first()
        .map(|line| line.trim().is_empty())
        .unwrap_or(false)
    {
        lines.remove(0);
    }
    while lines
        .last()
        .map(|line| line.trim().is_empty())
        .unwrap_or(false)
    {
        lines.pop();
    }

    if lines.is_empty() {
        String::new()
    } else {
        format!("{}\n", lines.join("\n"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_options() -> RewriteOptions {
        RewriteOptions::default()
    }

    #[test]
    fn rewrite_collapses_excess_blank_lines_left_by_old_blocks() {
        let content = "use crate::foo;\n\nmod b;\n\n\nmod a;\n\n\n\nfn keep() {}\n";
        let mut declarations = Vec::new();
        declarations.extend(build_desired_declarations(
            "a",
            &Visibility::Private,
            &[],
            &ReexportMode::Disabled,
        ));
        declarations.extend(build_desired_declarations(
            "b",
            &Visibility::Private,
            &[],
            &ReexportMode::Disabled,
        ));
        sort_desired_declarations(&mut declarations, &default_options());

        let rewritten = rewrite_target_content(content, &declarations, &default_options());
        assert_eq!(
            rewritten,
            "use crate::foo;\n\nmod a;\nmod b;\n\nfn keep() {}\n"
        );
    }

    #[test]
    fn rewrite_trims_trailing_spaces_from_preserved_lines() {
        let content = "use crate::foo;   \n\nmod a;   \n";
        let declarations =
            build_desired_declarations("a", &Visibility::Private, &[], &ReexportMode::Disabled);

        let rewritten = rewrite_target_content(content, &declarations, &default_options());
        assert_eq!(rewritten, "use crate::foo;\nmod a;\n");
    }

    #[test]
    fn rewrite_preserves_cfg_blocks_without_pulling_leading_blank_lines() {
        let content = "use crate::foo;\n\n#[cfg(test)]\nmod a;\n\nmod b;\n";
        let mut declarations = Vec::new();
        declarations.extend(build_desired_declarations(
            "a",
            &Visibility::Private,
            &[String::from("test")],
            &ReexportMode::Disabled,
        ));
        declarations.extend(build_desired_declarations(
            "b",
            &Visibility::Private,
            &[],
            &ReexportMode::Disabled,
        ));
        sort_desired_declarations(&mut declarations, &default_options());

        let rewritten = rewrite_target_content(content, &declarations, &default_options());
        assert_eq!(
            rewritten,
            "use crate::foo;\n#[cfg(test)]\nmod a;\n\nmod b;\n"
        );
    }

    #[test]
    fn rewrite_inserts_managed_declarations_after_multiline_use_blocks() {
        let content = "use crate::{\n    alpha,\n    beta,\n};\n\nfn keep() {}\n";
        let declarations =
            build_desired_declarations("user", &Visibility::Private, &[], &ReexportMode::Disabled);

        let rewritten = rewrite_target_content(content, &declarations, &default_options());
        assert_eq!(
            rewritten,
            "use crate::{\n    alpha,\n    beta,\n};\n\nmod user;\n\nfn keep() {}\n"
        );
    }

    #[test]
    fn rewrite_respects_group_order_when_use_is_last() {
        let content = "use crate::shared::Result;\n\nfn keep() {}\n";
        let declarations =
            build_desired_declarations("user", &Visibility::Private, &[], &ReexportMode::Disabled);
        let mut options = default_options();
        options.group_order = vec![
            GroupOrder::Cfg,
            GroupOrder::PubMod,
            GroupOrder::Mod,
            GroupOrder::PubUse,
            GroupOrder::Use,
        ];

        let rewritten = rewrite_target_content(content, &declarations, &options);
        assert_eq!(
            rewritten,
            "mod user;\n\nuse crate::shared::Result;\n\nfn keep() {}\n"
        );
    }
}
