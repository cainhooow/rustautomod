use anyhow::{anyhow, Context, Result};
use notify::{
    event::ModifyKind, Config as NotifyConfig, Event, EventKind, RecommendedWatcher, RecursiveMode,
    Watcher,
};
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::io::{self, BufReader};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use url::Url;

use crate::core::config::nearest_config_path;
use crate::core::modules::{
    discover_sync_targets_under_dir, find_existing_registration_target,
    is_registration_target_file, module_name_from_file_path,
    resolve_existing_parent_registration_target, resolve_parent_registration_target,
};
use crate::core::paths::{is_blacklisted_path, normalize_path_buf, path_within};
use crate::core::sync::{apply_target_sync_plan, build_target_sync_plan, read_target_text};
use crate::jsonrpc::{read_message, JsonRpcWriter};

const MODULE_CODE_ACTION_KIND: &str = "source.fixAll.rustautomod";
const WATCH_DEBOUNCE_MS: u64 = 350;
const SELF_WRITE_GRACE_MS: u64 = 2_000;
const WATCHER_STARTUP_GRACE_MS: u64 = 500;

#[derive(Clone, Debug)]
struct OpenDocument {
    uri: String,
    version: i64,
    text: String,
    dirty: bool,
}

#[derive(Clone)]
struct DaemonContext {
    workspace_root: PathBuf,
    writer: JsonRpcWriter,
    open_documents: Arc<Mutex<HashMap<PathBuf, OpenDocument>>>,
    self_authored_paths: Arc<Mutex<HashMap<PathBuf, Instant>>>,
    shutdown_requested: Arc<AtomicBool>,
    started_at: Instant,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DaemonMode {
    RustActionsLsp,
}

#[derive(Debug)]
struct DaemonConfig {
    mode: DaemonMode,
    workspace_root: PathBuf,
}

pub fn run(args: Vec<String>) -> Result<()> {
    let config = parse_args(args)?;
    match config.mode {
        DaemonMode::RustActionsLsp => run_rust_actions_lsp(config),
    }
}

fn run_rust_actions_lsp(config: DaemonConfig) -> Result<()> {
    let writer = JsonRpcWriter::new();
    let context = DaemonContext {
        workspace_root: normalize_path_buf(&config.workspace_root),
        writer: writer.clone(),
        open_documents: Arc::new(Mutex::new(HashMap::new())),
        self_authored_paths: Arc::new(Mutex::new(HashMap::new())),
        shutdown_requested: Arc::new(AtomicBool::new(false)),
        started_at: Instant::now(),
    };

    let _watcher = start_workspace_watcher(&context)?;
    let stdin = io::stdin();
    let mut reader = BufReader::new(stdin);

    while !context.shutdown_requested.load(Ordering::Relaxed) {
        let Some(message) = read_message(&mut reader)? else {
            break;
        };

        if let Some(method) = message.get("method").and_then(Value::as_str) {
            if message.get("id").is_some() {
                handle_request(&context, &message, method)?;
            } else {
                let should_exit = handle_notification(&context, &message, method)?;
                if should_exit {
                    break;
                }
            }
        }
    }

    context.shutdown_requested.store(true, Ordering::Relaxed);
    Ok(())
}

fn parse_args(args: Vec<String>) -> Result<DaemonConfig> {
    let mut mode = None;
    let mut workspace_root = None;
    let mut iter = args.into_iter();

    while let Some(argument) = iter.next() {
        match argument.as_str() {
            "--mode" => {
                let value = iter
                    .next()
                    .ok_or_else(|| anyhow!("missing value for --mode"))?;
                mode = Some(match value.as_str() {
                    "rust-actions-lsp" => DaemonMode::RustActionsLsp,
                    _ => return Err(anyhow!("unsupported daemon mode: {value}")),
                });
            }
            "--workspace-root" => {
                let value = iter
                    .next()
                    .ok_or_else(|| anyhow!("missing value for --workspace-root"))?;
                workspace_root = Some(PathBuf::from(value));
            }
            _ => return Err(anyhow!("unknown argument: {argument}")),
        }
    }

    let workspace_root = workspace_root.ok_or_else(|| anyhow!("--workspace-root is required"))?;
    Ok(DaemonConfig {
        mode: mode.unwrap_or(DaemonMode::RustActionsLsp),
        workspace_root,
    })
}

fn handle_request(context: &DaemonContext, message: &Value, method: &str) -> Result<()> {
    let id = message.get("id").cloned().unwrap_or(Value::Null);
    match method {
        "initialize" => {
            context.writer.send_response(
                id,
                json!({
                    "capabilities": {
                        "textDocumentSync": {
                            "openClose": true,
                            "change": 1,
                            "save": { "includeText": true }
                        },
                        "codeActionProvider": {
                            "codeActionKinds": ["quickfix", MODULE_CODE_ACTION_KIND]
                        }
                    },
                    "serverInfo": {
                        "name": "Rust AutoMod Rust Actions Daemon",
                        "version": "0.4.6"
                    }
                }),
            )?;
        }
        "textDocument/codeAction" => {
            let actions = code_actions_for_params(context, message.get("params"))?;
            context.writer.send_response(id, Value::Array(actions))?;
        }
        "rustautomod/ping" => {
            context.writer.send_response(
                id,
                json!({ "ok": true, "workspaceRoot": context.workspace_root }),
            )?;
        }
        "rustautomod/syncNow" => {
            let changed = sync_now(context, message.get("params"))?;
            context
                .writer
                .send_response(id, json!({ "ok": true, "changedTargets": changed }))?;
        }
        "shutdown" => {
            context.shutdown_requested.store(true, Ordering::Relaxed);
            context.writer.send_response(id, Value::Null)?;
        }
        _ => {
            context.writer.send_response(id, Value::Null)?;
        }
    }

    Ok(())
}

fn handle_notification(context: &DaemonContext, message: &Value, method: &str) -> Result<bool> {
    match method {
        "initialized" => Ok(false),
        "textDocument/didOpen" => {
            let text_document = message
                .get("params")
                .and_then(|value| value.get("textDocument"))
                .ok_or_else(|| anyhow!("didOpen missing textDocument"))?;
            open_document(context, text_document)?;
            Ok(false)
        }
        "textDocument/didChange" => {
            let params = message
                .get("params")
                .ok_or_else(|| anyhow!("didChange missing params"))?;
            change_document(context, params)?;
            Ok(false)
        }
        "textDocument/didSave" => {
            let params = message
                .get("params")
                .ok_or_else(|| anyhow!("didSave missing params"))?;
            save_document(context, params)?;
            Ok(false)
        }
        "textDocument/didClose" => {
            let text_document = message
                .get("params")
                .and_then(|value| value.get("textDocument"))
                .ok_or_else(|| anyhow!("didClose missing textDocument"))?;
            close_document(context, text_document)?;
            Ok(false)
        }
        "exit" => {
            context.shutdown_requested.store(true, Ordering::Relaxed);
            Ok(true)
        }
        _ => Ok(false),
    }
}

fn open_document(context: &DaemonContext, text_document: &Value) -> Result<()> {
    let uri = text_document
        .get("uri")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("didOpen missing uri"))?;
    let file_path = file_path_from_uri(uri)?;
    let version = text_document
        .get("version")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let text = text_document
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    with_open_documents(context, |documents| {
        documents.insert(
            normalize_path_buf(&file_path),
            OpenDocument {
                uri: uri.to_string(),
                version,
                text,
                dirty: false,
            },
        );
    })?;

    publish_diagnostics_for_path(context, &file_path)?;
    Ok(())
}

fn change_document(context: &DaemonContext, params: &Value) -> Result<()> {
    let uri = params
        .get("textDocument")
        .and_then(|value| value.get("uri"))
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("didChange missing uri"))?;
    let file_path = file_path_from_uri(uri)?;
    let version = params
        .get("textDocument")
        .and_then(|value| value.get("version"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let text = params
        .get("contentChanges")
        .and_then(Value::as_array)
        .and_then(|changes| changes.last())
        .and_then(|change| change.get("text"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    with_open_documents(context, |documents| {
        if let Some(document) = documents.get_mut(&normalize_path_buf(&file_path)) {
            document.version = version;
            document.text = text;
            document.dirty = true;
        }
    })?;

    publish_diagnostics_for_path(context, &file_path)?;
    Ok(())
}

fn save_document(context: &DaemonContext, params: &Value) -> Result<()> {
    let uri = params
        .get("textDocument")
        .and_then(|value| value.get("uri"))
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("didSave missing uri"))?;
    let file_path = file_path_from_uri(uri)?;
    let text = params
        .get("text")
        .and_then(Value::as_str)
        .map(ToString::to_string);

    with_open_documents(context, |documents| {
        if let Some(document) = documents.get_mut(&normalize_path_buf(&file_path)) {
            if let Some(text) = text {
                document.text = text;
            }
            document.dirty = false;
        }
    })?;

    publish_diagnostics_for_path(context, &file_path)?;
    Ok(())
}

fn close_document(context: &DaemonContext, text_document: &Value) -> Result<()> {
    let uri = text_document
        .get("uri")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("didClose missing uri"))?;
    let file_path = file_path_from_uri(uri)?;

    with_open_documents(context, |documents| {
        documents.remove(&normalize_path_buf(&file_path));
    })?;

    context.writer.send_notification(
        "textDocument/publishDiagnostics",
        json!({
            "uri": uri,
            "diagnostics": []
        }),
    )?;

    Ok(())
}

fn code_actions_for_params(context: &DaemonContext, params: Option<&Value>) -> Result<Vec<Value>> {
    let params = params.ok_or_else(|| anyhow!("codeAction missing params"))?;
    let uri = params
        .get("textDocument")
        .and_then(|value| value.get("uri"))
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("codeAction missing uri"))?;
    let file_path = file_path_from_uri(uri)?;
    let open_documents = snapshot_open_documents(context)?;
    let mut actions = Vec::new();

    if let Some(action) = build_register_module_action(context, &file_path, &open_documents)? {
        actions.push(action);
    }

    if let Some(action) = build_sync_children_action(context, &file_path, &open_documents)? {
        actions.push(action);
    }

    Ok(actions)
}

fn build_register_module_action(
    context: &DaemonContext,
    file_path: &Path,
    open_documents: &HashMap<PathBuf, OpenDocument>,
) -> Result<Option<Value>> {
    let Some(module_name) = module_name_from_file_path(file_path) else {
        return Ok(None);
    };
    if !path_is_in_automod_scope(file_path) {
        return Ok(None);
    }
    let Some(target_path) = resolve_parent_registration_target(file_path) else {
        return Ok(None);
    };

    if !path_within(&context.workspace_root, &target_path) || is_blacklisted_path(&target_path) {
        return Ok(None);
    }
    if !path_is_in_automod_scope(&target_path) {
        return Ok(None);
    }

    let current_text = read_text_with_open_documents(&target_path, open_documents)?;
    let Some(plan) = build_target_sync_plan(&target_path, current_text)? else {
        return Ok(None);
    };

    if !plan
        .desired_modules
        .iter()
        .any(|value| value == &module_name)
        || !plan
            .missing_modules
            .iter()
            .any(|value| value == &module_name)
    {
        return Ok(None);
    }

    let title = if plan.existed_before {
        "Rust AutoMod: Register this module in the parent target"
    } else {
        "Rust AutoMod: Create parent target and register this module"
    };

    Ok(Some(json!({
        "title": title,
        "kind": "quickfix",
        "edit": workspace_edit_for_plan(&plan)?
    })))
}

fn build_sync_children_action(
    context: &DaemonContext,
    file_path: &Path,
    open_documents: &HashMap<PathBuf, OpenDocument>,
) -> Result<Option<Value>> {
    if !is_registration_target_file(file_path) {
        return Ok(None);
    }

    if !path_within(&context.workspace_root, file_path) || is_blacklisted_path(file_path) {
        return Ok(None);
    }
    if !path_is_in_automod_scope(file_path) {
        return Ok(None);
    }

    let current_text = read_text_with_open_documents(file_path, open_documents)?;
    let Some(plan) = build_target_sync_plan(file_path, current_text)? else {
        return Ok(None);
    };

    if plan.missing_modules.is_empty() {
        return Ok(None);
    }

    let title = if plan.missing_modules.len() == 1 {
        "Rust AutoMod: Register the missing child module".to_string()
    } else {
        format!(
            "Rust AutoMod: Register {} missing child modules",
            plan.missing_modules.len()
        )
    };

    Ok(Some(json!({
        "title": title,
        "kind": MODULE_CODE_ACTION_KIND,
        "edit": workspace_edit_for_plan(&plan)?
    })))
}

fn workspace_edit_for_plan(plan: &crate::core::sync::TargetSyncPlan) -> Result<Value> {
    let target_uri = file_uri_from_path(&plan.target_path)?;
    if plan.existed_before {
        Ok(json!({
            "changes": {
                target_uri.clone(): [{
                    "range": full_document_range(&plan.current_text),
                    "newText": plan.next_text
                }]
            }
        }))
    } else {
        Ok(json!({
            "documentChanges": [
                {
                    "kind": "create",
                    "uri": target_uri
                },
                {
                    "textDocument": {
                        "uri": target_uri,
                        "version": Value::Null
                    },
                    "edits": [{
                        "range": zero_range(),
                        "newText": plan.next_text
                    }]
                }
            ]
        }))
    }
}

fn sync_now(context: &DaemonContext, params: Option<&Value>) -> Result<usize> {
    let targets = if let Some(path_param) = params
        .and_then(|value| value.get("path"))
        .and_then(Value::as_str)
    {
        let requested_path = if path_param.starts_with("file:") {
            file_path_from_uri(path_param)?
        } else {
            normalize_path_buf(&context.workspace_root.join(path_param))
        };
        collect_targets_for_manual_sync(context, &requested_path)
    } else {
        discover_sync_targets_under_dir(&context.workspace_root)
    };

    let changed = sync_target_set(context, &targets)?;
    publish_diagnostics_for_open_documents(context)?;
    Ok(changed)
}

fn collect_targets_for_manual_sync(context: &DaemonContext, requested_path: &Path) -> Vec<PathBuf> {
    let requested_path = normalize_path_buf(requested_path);
    if requested_path
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value == ".rautomod")
    {
        return discover_sync_targets_under_dir(&context.workspace_root);
    }

    let mut targets = BTreeSet::new();
    if requested_path.is_dir() {
        targets.extend(discover_sync_targets_under_dir(&requested_path));
        if let Some(parent_dir) = requested_path.parent() {
            if let Some(existing_target) = find_existing_registration_target(parent_dir) {
                targets.insert(existing_target);
            }
        }
        return targets.into_iter().collect();
    }

    if requested_path.extension().and_then(|value| value.to_str()) == Some("rs") {
        if is_registration_target_file(&requested_path) {
            targets.insert(requested_path.clone());
        }
        if let Some(parent_target) = resolve_parent_registration_target(&requested_path) {
            targets.insert(parent_target);
        }
    }

    targets.into_iter().collect()
}

fn start_workspace_watcher(context: &DaemonContext) -> Result<RecommendedWatcher> {
    let (event_tx, event_rx) = mpsc::channel::<notify::Result<Event>>();
    let mut watcher = RecommendedWatcher::new(
        move |event| {
            let _ = event_tx.send(event);
        },
        NotifyConfig::default(),
    )?;

    watcher.watch(&context.workspace_root, RecursiveMode::Recursive)?;

    let watcher_context = context.clone();
    thread::spawn(move || watcher_loop(watcher_context, event_rx));

    Ok(watcher)
}

fn watcher_loop(context: DaemonContext, event_rx: mpsc::Receiver<notify::Result<Event>>) {
    let debounce = Duration::from_millis(WATCH_DEBOUNCE_MS);
    let mut pending_paths = HashMap::new();
    let mut full_rescan = false;

    while !context.shutdown_requested.load(Ordering::Relaxed) {
        match event_rx.recv_timeout(debounce) {
            Ok(Ok(event)) => {
                let event_targets = relevant_paths_for_event(&context, &event);
                full_rescan |= event_targets.full_rescan;
                for (path, intent) in event_targets.paths {
                    pending_paths
                        .entry(path)
                        .and_modify(|current: &mut WatchIntent| *current = current.merge(intent))
                        .or_insert(intent);
                }
            }
            Ok(Err(error)) => {
                eprintln!("rustautomod-zed-daemon: watcher error: {error}");
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if pending_paths.is_empty() && !full_rescan {
                    continue;
                }

                let targets = if full_rescan {
                    discover_sync_targets_under_dir(&context.workspace_root)
                } else {
                    collect_targets_for_watcher(&context, &pending_paths)
                };

                if let Err(error) = sync_target_set(&context, &targets) {
                    eprintln!("rustautomod-zed-daemon: watcher sync failed: {error:#}");
                }

                if let Err(error) = publish_diagnostics_for_open_documents(&context) {
                    eprintln!("rustautomod-zed-daemon: failed to refresh diagnostics: {error:#}");
                }

                pending_paths.clear();
                full_rescan = false;
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

#[derive(Default)]
struct EventPaths {
    full_rescan: bool,
    paths: HashMap<PathBuf, WatchIntent>,
}

#[derive(Clone, Copy, Debug, Default)]
struct WatchIntent {
    allow_missing_target: bool,
}

impl WatchIntent {
    fn merge(self, other: WatchIntent) -> WatchIntent {
        WatchIntent {
            allow_missing_target: self.allow_missing_target || other.allow_missing_target,
        }
    }
}

fn relevant_paths_for_event(context: &DaemonContext, event: &Event) -> EventPaths {
    let mut collected = EventPaths::default();
    let past_startup_grace = watcher_past_startup_grace(context);

    for raw_path in &event.paths {
        let path = normalize_path_buf(raw_path);
        if !path_within(&context.workspace_root, &path) || is_blacklisted_path(&path) {
            continue;
        }

        if should_ignore_self_authored_event(context, &path) {
            continue;
        }

        let is_rautomod = path
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value == ".rautomod");
        if is_rautomod && !matches!(event.kind, EventKind::Access(_)) {
            collected.full_rescan = true;
            continue;
        }

        if path.extension().and_then(|value| value.to_str()) == Some("rs") {
            if is_structural_rust_event(&event.kind) {
                let intent = WatchIntent {
                    allow_missing_target: past_startup_grace
                        && should_allow_missing_target_for_event(&event.kind, &path),
                };
                collected
                    .paths
                    .entry(path)
                    .and_modify(|current| *current = current.merge(intent))
                    .or_insert(intent);
            }
            continue;
        }

        if is_structural_rust_event(&event.kind) && path.extension().is_none() {
            collected.paths.entry(path).or_default();
        }
    }

    collected
}

fn is_structural_rust_event(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(_)
            | EventKind::Remove(_)
            | EventKind::Modify(ModifyKind::Name(_))
            | EventKind::Any
    )
}

fn collect_targets_for_watcher(
    context: &DaemonContext,
    paths: &HashMap<PathBuf, WatchIntent>,
) -> Vec<PathBuf> {
    let mut targets = BTreeSet::new();

    for (path, intent) in paths {
        if path
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value == ".rautomod")
        {
            return discover_sync_targets_under_dir(&context.workspace_root);
        }

        if path.extension().and_then(|value| value.to_str()) == Some("rs") {
            if path.exists() && is_registration_target_file(path) {
                if let Some(parent_target) = resolve_parent_registration_target(path) {
                    targets.insert(parent_target);
                }
            } else if intent.allow_missing_target {
                if let Some(parent_target) = resolve_parent_registration_target(path) {
                    targets.insert(parent_target);
                }
            } else if let Some(parent_target) = resolve_existing_parent_registration_target(path) {
                targets.insert(parent_target);
            }
            continue;
        }

        if path.extension().is_none() {
            if let Some(parent_dir) = path.parent() {
                if let Some(existing_target) = find_existing_registration_target(parent_dir) {
                    targets.insert(existing_target);
                }
            }
        }
    }

    targets.into_iter().collect()
}

fn should_allow_missing_target_for_event(kind: &EventKind, path: &Path) -> bool {
    match kind {
        EventKind::Create(_) => is_recent_file(path),
        EventKind::Modify(ModifyKind::Name(_)) => true,
        EventKind::Any => is_recent_file(path),
        _ => false,
    }
}

fn is_recent_file(path: &Path) -> bool {
    let Ok(metadata) = path.metadata() else {
        return false;
    };
    let Ok(modified_at) = metadata.modified() else {
        return false;
    };

    modified_at
        .elapsed()
        .map(|elapsed| elapsed <= Duration::from_secs(2))
        .unwrap_or(false)
}

fn watcher_past_startup_grace(context: &DaemonContext) -> bool {
    context.started_at.elapsed() >= Duration::from_millis(WATCHER_STARTUP_GRACE_MS)
}

fn sync_target_set(context: &DaemonContext, targets: &[PathBuf]) -> Result<usize> {
    let mut changed_count = 0usize;
    for target_path in targets {
        changed_count += sync_target_chain(context, target_path)?;
    }
    Ok(changed_count)
}

fn sync_target_chain(context: &DaemonContext, initial_target: &Path) -> Result<usize> {
    let mut changed_count = 0usize;
    let mut current_target = Some(normalize_path_buf(initial_target));
    let mut visited = HashSet::new();

    while let Some(target_path) = current_target {
        if !visited.insert(target_path.clone()) {
            break;
        }

        if !path_within(&context.workspace_root, &target_path) || is_blacklisted_path(&target_path)
        {
            break;
        }
        if !path_is_in_automod_scope(&target_path) {
            break;
        }

        changed_count += sync_single_target(context, &target_path)?;
        current_target = resolve_existing_parent_registration_target(&target_path)
            .map(|value| normalize_path_buf(&value));
    }

    Ok(changed_count)
}

fn sync_single_target(context: &DaemonContext, target_path: &Path) -> Result<usize> {
    if is_open_in_editor(context, target_path)? {
        return Ok(0);
    }
    if !path_is_in_automod_scope(target_path) {
        return Ok(0);
    }

    let current_text = read_target_text(target_path)?;
    let Some(plan) = build_target_sync_plan(target_path, current_text)? else {
        return Ok(0);
    };

    if !plan.changed() {
        return Ok(0);
    }

    apply_target_sync_plan(&plan)?;
    mark_self_authored_path(context, target_path)?;
    Ok(1)
}

fn publish_diagnostics_for_open_documents(context: &DaemonContext) -> Result<()> {
    let documents = snapshot_open_documents(context)?;
    for file_path in documents.keys() {
        publish_diagnostics_for_path(context, file_path)?;
    }
    Ok(())
}

fn publish_diagnostics_for_path(context: &DaemonContext, file_path: &Path) -> Result<()> {
    let documents = snapshot_open_documents(context)?;
    let Some(document) = documents.get(&normalize_path_buf(file_path)) else {
        return Ok(());
    };

    let diagnostics = diagnostics_for_rust_file(context, file_path, &documents)?;
    context.writer.send_notification(
        "textDocument/publishDiagnostics",
        json!({
            "uri": document.uri,
            "diagnostics": diagnostics
        }),
    )?;
    Ok(())
}

fn diagnostics_for_rust_file(
    context: &DaemonContext,
    file_path: &Path,
    open_documents: &HashMap<PathBuf, OpenDocument>,
) -> Result<Vec<Value>> {
    let file_path = normalize_path_buf(file_path);
    let Some(document) = open_documents.get(&file_path) else {
        return Ok(Vec::new());
    };

    let mut diagnostics = Vec::new();

    if let Some(module_name) = module_name_from_file_path(&file_path) {
        if !path_is_in_automod_scope(&file_path) {
            return Ok(diagnostics);
        }

        if let Some(parent_target) = resolve_parent_registration_target(&file_path) {
            if path_within(&context.workspace_root, &parent_target)
                && !is_blacklisted_path(&parent_target)
                && path_is_in_automod_scope(&parent_target)
            {
                let current_text = read_text_with_open_documents(&parent_target, open_documents)?;
                if let Some(plan) = build_target_sync_plan(&parent_target, current_text)? {
                    if plan
                        .missing_modules
                        .iter()
                        .any(|value| value == &module_name)
                    {
                        diagnostics.push(json!({
                            "range": first_line_range(&document.text),
                            "severity": 2,
                            "code": "missing_parent_registration",
                            "source": "rustautomod-zed",
                            "message": if plan.existed_before {
                                format!(
                                    "Module is not registered in {}.",
                                    parent_target.file_name().and_then(|value| value.to_str()).unwrap_or("parent target")
                                )
                            } else {
                                format!(
                                    "Module is not registered yet and the parent target {} does not exist.",
                                    parent_target.file_name().and_then(|value| value.to_str()).unwrap_or("parent target")
                                )
                            }
                        }));
                    }
                }
            }
        }
    }

    if is_registration_target_file(&file_path) {
        if !path_is_in_automod_scope(&file_path) {
            return Ok(diagnostics);
        }

        let current_text = read_text_with_open_documents(&file_path, open_documents)?;
        if let Some(plan) = build_target_sync_plan(&file_path, current_text)? {
            if !plan.missing_modules.is_empty() {
                diagnostics.push(json!({
                    "range": first_line_range(&document.text),
                    "severity": 2,
                    "code": "missing_child_registrations",
                    "source": "rustautomod-zed",
                    "message": if plan.missing_modules.len() == 1 {
                        format!(
                            "One child module is missing from this target: {}.",
                            plan.missing_modules[0]
                        )
                    } else {
                        format!(
                            "{} child modules are missing from this target: {}.",
                            plan.missing_modules.len(),
                            plan.missing_modules.join(", ")
                        )
                    }
                }));
            }
        }
    }

    Ok(diagnostics)
}

fn read_text_with_open_documents(
    target_path: &Path,
    open_documents: &HashMap<PathBuf, OpenDocument>,
) -> Result<Option<String>> {
    if let Some(document) = open_documents.get(&normalize_path_buf(target_path)) {
        return Ok(Some(document.text.clone()));
    }

    read_target_text(target_path)
}

fn first_line_range(text: &str) -> Value {
    let normalized = text.replace("\r\n", "\n");
    let first_line_length = normalized.split('\n').next().map(str::len).unwrap_or(0);

    json!({
        "start": { "line": 0, "character": 0 },
        "end": { "line": 0, "character": first_line_length }
    })
}

fn full_document_range(text: &str) -> Value {
    let normalized = text.replace("\r\n", "\n");
    let lines = normalized.split('\n').collect::<Vec<_>>();
    let last_line = lines.len().saturating_sub(1);
    let last_character = lines.get(last_line).map(|line| line.len()).unwrap_or(0);

    json!({
        "start": { "line": 0, "character": 0 },
        "end": { "line": last_line, "character": last_character }
    })
}

fn zero_range() -> Value {
    json!({
        "start": { "line": 0, "character": 0 },
        "end": { "line": 0, "character": 0 }
    })
}

fn is_open_in_editor(context: &DaemonContext, target_path: &Path) -> Result<bool> {
    let documents = context
        .open_documents
        .lock()
        .map_err(|_| anyhow!("open document mutex poisoned"))?;
    Ok(documents.contains_key(&normalize_path_buf(target_path)))
}

fn mark_self_authored_path(context: &DaemonContext, target_path: &Path) -> Result<()> {
    let mut self_authored = context
        .self_authored_paths
        .lock()
        .map_err(|_| anyhow!("self-authored mutex poisoned"))?;
    prune_self_authored(&mut self_authored);
    self_authored.insert(normalize_path_buf(target_path), Instant::now());
    Ok(())
}

fn should_ignore_self_authored_event(context: &DaemonContext, path: &Path) -> bool {
    let Ok(mut self_authored) = context.self_authored_paths.lock() else {
        return false;
    };
    prune_self_authored(&mut self_authored);
    self_authored.contains_key(&normalize_path_buf(path))
}

fn prune_self_authored(self_authored: &mut HashMap<PathBuf, Instant>) {
    let cutoff = Instant::now()
        .checked_sub(Duration::from_millis(SELF_WRITE_GRACE_MS))
        .unwrap_or_else(Instant::now);
    self_authored.retain(|_, instant| *instant >= cutoff);
}

fn snapshot_open_documents(context: &DaemonContext) -> Result<HashMap<PathBuf, OpenDocument>> {
    let documents = context
        .open_documents
        .lock()
        .map_err(|_| anyhow!("open document mutex poisoned"))?;
    Ok(documents.clone())
}

fn with_open_documents(
    context: &DaemonContext,
    updater: impl FnOnce(&mut HashMap<PathBuf, OpenDocument>),
) -> Result<()> {
    let mut documents = context
        .open_documents
        .lock()
        .map_err(|_| anyhow!("open document mutex poisoned"))?;
    updater(&mut documents);
    Ok(())
}

fn file_path_from_uri(uri: &str) -> Result<PathBuf> {
    let url = Url::parse(uri).with_context(|| format!("invalid file URI: {uri}"))?;
    url.to_file_path()
        .map(|path| normalize_path_buf(&path))
        .map_err(|_| anyhow!("URI does not point to a local file: {uri}"))
}

fn file_uri_from_path(file_path: &Path) -> Result<String> {
    Url::from_file_path(file_path)
        .map_err(|_| anyhow!("failed to convert {} to file URI", file_path.display()))
        .map(|url| url.to_string())
}

fn path_is_in_automod_scope(path: &Path) -> bool {
    nearest_config_path(path).is_some()
}
