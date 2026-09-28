// JSON-RPC Content-Length framing: encode outgoing messages, decode incoming stream.

use std::io::{self, BufRead, Write};

/// Encode a JSON body into Content-Length framed bytes.
pub fn encode(body: &[u8]) -> Vec<u8> {
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    let mut out = Vec::with_capacity(header.len() + body.len());
    out.extend_from_slice(header.as_bytes());
    out.extend_from_slice(body);
    out
}

/// Encode a serde_json::Value into a framed message.
pub fn encode_msg(msg: &serde_json::Value) -> Vec<u8> {
    let body = serde_json::to_vec(msg).expect("json encode");
    encode(&body)
}

/// Reads one Content-Length framed message from a buffered reader.
/// Returns the body as bytes, or an io error (including UnexpectedEof).
pub fn decode_one<R: BufRead>(reader: &mut R) -> io::Result<Vec<u8>> {
    let mut content_length: Option<usize> = None;

    // Read headers line by line until empty line (\r\n)
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line)?;
        if n == 0 {
            return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "stream ended"));
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            break; // end of headers
        }
        // Parse Content-Length (case-insensitive)
        if let Some(val) = trimmed.strip_prefix("Content-Length:").or_else(|| trimmed.strip_prefix("content-length:")) {
            if let Ok(len) = val.trim().parse::<usize>() {
                content_length = Some(len);
            }
        }
        // Other headers (Content-Type, etc.) are ignored
    }

    let len = content_length.ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidData, "missing Content-Length header")
    })?;

    let mut body = vec![0u8; len];
    reader.read_exact(&mut body)?;
    Ok(body)
}

/// Iterator that yields decoded JSON values from a buffered reader.
pub struct MessageStream<R> {
    reader: R,
}

impl<R: BufRead> MessageStream<R> {
    pub fn new(reader: R) -> Self {
        Self { reader }
    }

    /// Read next message. Returns None on EOF, Some(Err) on other errors.
    pub fn next_message(&mut self) -> Option<io::Result<serde_json::Value>> {
        match decode_one(&mut self.reader) {
            Ok(body) => match serde_json::from_slice(&body) {
                Ok(v) => Some(Ok(v)),
                Err(e) => Some(Err(io::Error::new(io::ErrorKind::InvalidData, e))),
            },
            Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => None,
            Err(e) => Some(Err(e)),
        }
    }
}

/// Write a JSON-RPC message to a writer (with Content-Length framing).
pub fn write_msg<W: Write>(writer: &mut W, msg: &serde_json::Value) -> io::Result<()> {
    let encoded = encode_msg(msg);
    writer.write_all(&encoded)?;
    writer.flush()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufReader;

    #[test]
    fn encode_decode_roundtrip() {
        let body = br#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#;
        let framed = encode(body);
        let mut reader = BufReader::new(&framed[..]);
        let decoded = decode_one(&mut reader).unwrap();
        assert_eq!(decoded, body);
    }

    #[test]
    fn multiple_messages_in_stream() {
        let m1 = serde_json::json!({"jsonrpc":"2.0","id":1,"method":"a"});
        let m2 = serde_json::json!({"jsonrpc":"2.0","id":2,"method":"b"});
        let m3 = serde_json::json!({"jsonrpc":"2.0","method":"c","params":{}});

        let mut buf = Vec::new();
        buf.extend_from_slice(&encode_msg(&m1));
        buf.extend_from_slice(&encode_msg(&m2));
        buf.extend_from_slice(&encode_msg(&m3));

        let mut stream = MessageStream::new(BufReader::new(&buf[..]));
        assert_eq!(stream.next_message().unwrap().unwrap(), m1);
        assert_eq!(stream.next_message().unwrap().unwrap(), m2);
        assert_eq!(stream.next_message().unwrap().unwrap(), m3);
        assert!(stream.next_message().is_none()); // EOF
    }

    #[test]
    fn truncated_message_errors() {
        // Header present but body cut short
        let body = br#"{"hello":"world"}"#;
        let mut framed = encode(body);
        framed.truncate(framed.len() - 5); // cut 5 bytes from body

        let mut reader = BufReader::new(&framed[..]);
        let result = decode_one(&mut reader);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().kind(), io::ErrorKind::UnexpectedEof);
    }

    #[test]
    fn extra_content_type_header() {
        // Some servers send Content-Type alongside Content-Length
        let body = br#"{"id":1}"#;
        let header = format!(
            "Content-Length: {}\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n",
            body.len()
        );
        let mut framed = Vec::new();
        framed.extend_from_slice(header.as_bytes());
        framed.extend_from_slice(body);

        let mut reader = BufReader::new(&framed[..]);
        let decoded = decode_one(&mut reader).unwrap();
        assert_eq!(decoded, body);
    }

    #[test]
    fn case_insensitive_header() {
        let body = br#"{"ok":true}"#;
        let header = format!("content-length: {}\r\n\r\n", body.len());
        let mut framed = Vec::new();
        framed.extend_from_slice(header.as_bytes());
        framed.extend_from_slice(body);

        let mut reader = BufReader::new(&framed[..]);
        let decoded = decode_one(&mut reader).unwrap();
        assert_eq!(decoded, body);
    }

    #[test]
    fn empty_stream_returns_eof() {
        let buf: &[u8] = &[];
        let mut reader = BufReader::new(buf);
        let result = decode_one(&mut reader);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().kind(), io::ErrorKind::UnexpectedEof);
    }
}
