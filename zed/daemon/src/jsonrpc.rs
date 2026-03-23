use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, BufWriter, Read, Write};
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct JsonRpcWriter {
    stdout: Arc<Mutex<BufWriter<std::io::Stdout>>>,
}

impl JsonRpcWriter {
    pub fn new() -> Self {
        Self {
            stdout: Arc::new(Mutex::new(BufWriter::new(std::io::stdout()))),
        }
    }

    pub fn send_response(&self, id: Value, result: Value) -> Result<()> {
        self.write_message(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": result
        }))
    }

    pub fn send_notification(&self, method: &str, params: Value) -> Result<()> {
        self.write_message(&json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        }))
    }

    fn write_message(&self, payload: &Value) -> Result<()> {
        let serialized = serde_json::to_string(payload)?;
        let mut stdout = self
            .stdout
            .lock()
            .map_err(|_| anyhow!("stdout mutex poisoned"))?;
        write!(
            stdout,
            "Content-Length: {}\r\n\r\n{}",
            serialized.len(),
            serialized
        )?;
        stdout.flush()?;
        Ok(())
    }
}

pub fn read_message(reader: &mut BufReader<std::io::Stdin>) -> Result<Option<Value>> {
    let mut header_line = String::new();
    let mut content_length = None;

    loop {
        header_line.clear();
        let bytes_read = reader.read_line(&mut header_line)?;
        if bytes_read == 0 {
            return Ok(None);
        }

        let trimmed = header_line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }

        if let Some(value) = trimmed.strip_prefix("Content-Length:") {
            content_length = Some(value.trim().parse::<usize>()?);
        }
    }

    let content_length = content_length.ok_or_else(|| anyhow!("missing Content-Length header"))?;
    let mut body = vec![0u8; content_length];
    reader.read_exact(&mut body)?;
    Ok(Some(serde_json::from_slice(&body)?))
}
