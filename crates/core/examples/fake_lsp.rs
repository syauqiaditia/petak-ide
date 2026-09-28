// Fake LSP server for testing. Responds to initialize, publishDiagnostics on didOpen.
// CLI args control behavior:
//   --crash-after-init  → exit(1) after initialized notification
//   --diag-text TEXT    → custom diagnostic message (default: "test error")

use std::io::{self, BufRead, BufReader, Write};

fn encode(body: &[u8]) -> Vec<u8> {
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    let mut out = Vec::with_capacity(header.len() + body.len());
    out.extend_from_slice(header.as_bytes());
    out.extend_from_slice(body);
    out
}

fn decode_one<R: BufRead>(reader: &mut R) -> io::Result<Vec<u8>> {
    let mut content_length: Option<usize> = None;
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line)?;
        if n == 0 {
            return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "eof"));
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            break;
        }
        if let Some(val) = trimmed.strip_prefix("Content-Length:") {
            if let Ok(len) = val.trim().parse::<usize>() {
                content_length = Some(len);
            }
        }
    }
    let len = content_length.ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "no CL"))?;
    let mut body = vec![0u8; len];
    io::Read::read_exact(reader, &mut body)?;
    Ok(body)
}

fn send(msg: &serde_json::Value) {
    let body = serde_json::to_vec(msg).unwrap();
    let framed = encode(&body);
    let stdout = io::stdout();
    let mut out = stdout.lock();
    out.write_all(&framed).unwrap();
    out.flush().unwrap();
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let crash_after_init = args.contains(&"--crash-after-init".to_string());
    let diag_text = args
        .windows(2)
        .find(|w| w[0] == "--diag-text")
        .map(|w| w[1].clone())
        .unwrap_or_else(|| "test error".to_string());

    let stdin = io::stdin();
    let mut reader = BufReader::new(stdin.lock());

    loop {
        let body = match decode_one(&mut reader) {
            Ok(b) => b,
            Err(_) => break,
        };
        let msg: serde_json::Value = match serde_json::from_slice(&body) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("");
        let id = msg.get("id");

        match method {
            "initialize" => {
                if let Some(id) = id {
                    send(&serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": {
                            "capabilities": {
                                "textDocumentSync": 2,
                                "completionProvider": {},
                                "hoverProvider": true,
                                "definitionProvider": true,
                            }
                        }
                    }));
                }
            }
            "initialized" => {
                if crash_after_init {
                    std::process::exit(1);
                }
            }
            "textDocument/didOpen" => {
                if let Some(uri) = msg.pointer("/params/textDocument/uri").and_then(|u| u.as_str()) {
                    send(&serde_json::json!({
                        "jsonrpc": "2.0",
                        "method": "textDocument/publishDiagnostics",
                        "params": {
                            "uri": uri,
                            "diagnostics": [{
                                "range": {
                                    "start": {"line": 0, "character": 0},
                                    "end": {"line": 0, "character": 5}
                                },
                                "severity": 1,
                                "message": diag_text,
                            }]
                        }
                    }));
                }
            }
            "shutdown" => {
                if let Some(id) = id {
                    send(&serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": null
                    }));
                }
            }
            "exit" => {
                break;
            }
            _ => {
                if let Some(id) = id {
                    send(&serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": null
                    }));
                }
            }
        }
    }
}
