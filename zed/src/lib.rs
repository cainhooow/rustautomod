use zed_extension_api as zed;

use std::path::{Path, PathBuf};
use zed::process::Command as ProcessCommand;
use zed::serde_json::{self, Value};

const EXTENSION_DIR: &str = env!("CARGO_MANIFEST_DIR");
const SLASH_COMMAND_ENTRY: &str = "scripts/rautomod_zed_commands.js";
const RAUTOMOD_LANGUAGE_SERVER_ENTRY: &str = "scripts/rautomod_zed_language_server.js";

struct RustAutomodZed;

impl RustAutomodZed {
    fn language_server_entry(language_server_id: &str) -> Option<String> {
        match language_server_id {
            "rautomod-language-server" => Some(extension_path(RAUTOMOD_LANGUAGE_SERVER_ENTRY)),
            _ => None,
        }
    }

    fn run_bridge(
        &self,
        command_name: &str,
        args: Vec<String>,
        worktree: &zed::Worktree,
    ) -> Result<Value, String> {
        let payload = serde_json::json!({
            "command": command_name,
            "args": args,
            "worktreeRoot": worktree.root_path(),
        });

        let mut process = ProcessCommand::new(node_binary_for(worktree)?)
            .arg(extension_path(SLASH_COMMAND_ENTRY))
            .env("RUST_AUTOMOD_ZED_INPUT", payload.to_string())
            .envs(worktree.shell_env());

        let output = process.output()?;

        if output.status != Some(0) {
            let stderr = String::from_utf8(output.stderr)
                .unwrap_or_else(|_| "Rust AutoMod Zed bridge failed.".to_string());
            return Err(stderr.trim().to_string());
        }

        let stdout = String::from_utf8(output.stdout)
            .map_err(|_| "Rust AutoMod Zed bridge returned non UTF-8 output.".to_string())?;
        serde_json::from_str::<Value>(&stdout)
            .map_err(|error| format!("Rust AutoMod Zed bridge returned invalid JSON: {error}"))
    }

    fn command_output(
        &self,
        command_name: &str,
        args: Vec<String>,
        worktree: &zed::Worktree,
    ) -> Result<zed::SlashCommandOutput, String> {
        let value = self.run_bridge(command_name, args, worktree)?;
        let ok = value.get("ok").and_then(Value::as_bool).unwrap_or(false);
        let text = value
            .get("body")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();

        if !ok {
            let message = value
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("Rust AutoMod Zed command failed.");
            return Err(message.to_string());
        }

        let title = value
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or(command_name)
            .to_string();

        Ok(zed::SlashCommandOutput {
            sections: vec![zed::SlashCommandOutputSection {
                range: (0..text.len()).into(),
                label: title,
            }],
            text,
        })
    }
}

impl zed::Extension for RustAutomodZed {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command, String> {
        if language_server_id.as_ref() == "rustautomod-rust-actions" {
            return Ok(zed::Command::new(cargo_binary_for(worktree)?)
                .args(rust_daemon_args(worktree))
                .envs(worktree.shell_env()));
        }

        let Some(entry_path) = Self::language_server_entry(language_server_id.as_ref()) else {
            return Err(format!(
                "Unknown Rust AutoMod language server: {language_server_id}"
            ));
        };

        Ok(zed::Command::new(node_binary_for(worktree)?)
            .arg(entry_path)
            .env("RUST_AUTOMOD_ZED_WORKTREE_ROOT", worktree.root_path())
            .envs(worktree.shell_env()))
    }

    fn run_slash_command(
        &self,
        command: zed::SlashCommand,
        args: Vec<String>,
        worktree: Option<&zed::Worktree>,
    ) -> Result<zed::SlashCommandOutput, String> {
        let Some(worktree) = worktree else {
            return Err("Rust AutoMod for Zed requires an open worktree.".to_string());
        };

        self.command_output(command.name.as_str(), args, worktree)
    }

    fn complete_slash_command_argument(
        &self,
        command: zed::SlashCommand,
        args: Vec<String>,
    ) -> Result<Vec<zed::SlashCommandArgumentCompletion>, String> {
        if command.name != "rautomod-create-pair" {
            return Ok(Vec::new());
        }

        let last = args.last().map(String::as_str).unwrap_or("");
        let candidates = if args.len() >= 3 {
            vec!["pub", "pub(crate)", "private"]
        } else if args.len() >= 4 {
            vec!["auto", "classic", "modern"]
        } else {
            Vec::new()
        };

        Ok(candidates
            .into_iter()
            .filter(|candidate| candidate.starts_with(last))
            .map(|candidate| zed::SlashCommandArgumentCompletion {
                label: candidate.to_string(),
                new_text: candidate.to_string(),
                run_command: false,
            })
            .collect())
    }
}

fn extension_path(relative_path: &str) -> String {
    Path::new(EXTENSION_DIR)
        .join(relative_path)
        .to_string_lossy()
        .to_string()
}

fn rust_daemon_args(worktree: &zed::Worktree) -> Vec<String> {
    vec![
        "run".to_string(),
        "--quiet".to_string(),
        "--manifest-path".to_string(),
        extension_path("daemon/Cargo.toml"),
        "--".to_string(),
        "--mode".to_string(),
        "rust-actions-lsp".to_string(),
        "--workspace-root".to_string(),
        normalize_worktree_root(worktree.root_path()),
    ]
}

fn normalize_worktree_root(root_path: String) -> String {
    PathBuf::from(root_path).to_string_lossy().to_string()
}

fn node_binary_for(worktree: &zed::Worktree) -> Result<String, String> {
    if let Some(path) = worktree.which("node") {
        return Ok(path);
    }

    zed::node_binary_path()
}

fn cargo_binary_for(worktree: &zed::Worktree) -> Result<String, String> {
    if let Some(path) = worktree.which("cargo") {
        return Ok(path);
    }

    Ok("cargo".to_string())
}

zed::register_extension!(RustAutomodZed);
