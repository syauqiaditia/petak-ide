// LSP Position (line, UTF-16 offset) ↔ byte offset in &str.

/// Convert a byte offset in `text` to an LSP Position (0-based line, 0-based UTF-16 character).
pub fn byte_offset_to_lsp(text: &str, offset: usize) -> Option<(u32, u32)> {
    if offset > text.len() {
        return None;
    }
    let mut line: u32 = 0;
    let mut line_start: usize = 0;

    for (i, b) in text.bytes().enumerate() {
        if i == offset {
            let col_utf16 = utf16_len(&text[line_start..offset]);
            return Some((line, col_utf16));
        }
        if b == b'\n' {
            line += 1;
            line_start = i + 1;
        }
    }

    // offset == text.len() (end of file)
    if offset == text.len() {
        let col_utf16 = utf16_len(&text[line_start..offset]);
        return Some((line, col_utf16));
    }
    None
}

/// Convert an LSP Position to a byte offset in `text`.
/// Returns None if the position is out of bounds.
pub fn lsp_to_byte_offset(text: &str, line: u32, character: u32) -> Option<usize> {
    let mut current_line: u32 = 0;
    let mut i: usize = 0;

    // Advance to the target line
    while current_line < line {
        if i >= text.len() {
            return None; // line beyond end of file
        }
        if text.as_bytes()[i] == b'\n' {
            current_line += 1;
        }
        i += 1;
    }

    // Now i is the start of the target line. Count UTF-16 code units.
    let line_start = i;
    let mut utf16_count: u32 = 0;

    for ch in text[line_start..].chars() {
        if ch == '\n' || ch == '\r' {
            break;
        }
        if utf16_count == character {
            return Some(i);
        }
        let units = ch.len_utf16() as u32;
        utf16_count += units;
        // If character falls within a surrogate pair
        if utf16_count > character {
            // Position is inside a multi-unit character — snap to start
            return Some(i);
        }
        i += ch.len_utf8();
    }

    // character == utf16_count means end of line (valid)
    if utf16_count == character {
        return Some(i);
    }
    // Beyond end of line — still return end of line (LSP servers do this)
    if character > utf16_count {
        return Some(i);
    }
    None
}

/// Count the number of UTF-16 code units in a string slice.
fn utf16_len(s: &str) -> u32 {
    s.chars().map(|c| c.len_utf16() as u32).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ascii() {
        let text = "hello\nworld";
        // 'w' is at byte 6, line 1 col 0
        assert_eq!(lsp_to_byte_offset(text, 1, 0), Some(6));
        assert_eq!(byte_offset_to_lsp(text, 6), Some((1, 0)));
        // 'o' in "world" is at byte 7, line 1 col 1
        assert_eq!(lsp_to_byte_offset(text, 1, 1), Some(7));
        assert_eq!(byte_offset_to_lsp(text, 7), Some((1, 1)));
        // end of "hello" line
        assert_eq!(lsp_to_byte_offset(text, 0, 5), Some(5));
        assert_eq!(byte_offset_to_lsp(text, 5), Some((0, 5)));
    }

    #[test]
    fn accent_e() {
        // 'é' is U+00E9, 2 bytes UTF-8, 1 UTF-16 code unit
        let text = "café\nbar";
        // 'é' at byte 3, UTF-16 col 3 (c=0, a=1, f=2, é=3)
        assert_eq!(lsp_to_byte_offset(text, 0, 3), Some(3));
        assert_eq!(byte_offset_to_lsp(text, 3), Some((0, 3)));
        // After 'é': byte 5 (3+2), UTF-16 col 4
        assert_eq!(lsp_to_byte_offset(text, 0, 4), Some(5));
        assert_eq!(byte_offset_to_lsp(text, 5), Some((0, 4)));
        // 'b' on line 1
        assert_eq!(lsp_to_byte_offset(text, 1, 0), Some(6));
        assert_eq!(byte_offset_to_lsp(text, 6), Some((1, 0)));
    }

    #[test]
    fn emoji_surrogate_pair() {
        // 😀 is U+1F600, 4 bytes UTF-8, 2 UTF-16 code units (surrogate pair)
        let text = "a😀b";
        // 'a' at byte 0, col 0
        assert_eq!(lsp_to_byte_offset(text, 0, 0), Some(0));
        // 😀 at byte 1, col 1
        assert_eq!(lsp_to_byte_offset(text, 0, 1), Some(1));
        assert_eq!(byte_offset_to_lsp(text, 1), Some((0, 1)));
        // 'b' at byte 5 (1+4), col 3 (1 + 2 UTF-16 units for 😀)
        assert_eq!(lsp_to_byte_offset(text, 0, 3), Some(5));
        assert_eq!(byte_offset_to_lsp(text, 5), Some((0, 3)));
    }

    #[test]
    fn cjk() {
        // CJK characters like '中' are U+4E2D, 3 bytes UTF-8, 1 UTF-16 code unit
        let text = "中文abc";
        // '中' at byte 0, col 0
        assert_eq!(lsp_to_byte_offset(text, 0, 0), Some(0));
        // '文' at byte 3, col 1
        assert_eq!(lsp_to_byte_offset(text, 0, 1), Some(3));
        assert_eq!(byte_offset_to_lsp(text, 3), Some((0, 1)));
        // 'a' at byte 6, col 2
        assert_eq!(lsp_to_byte_offset(text, 0, 2), Some(6));
        assert_eq!(byte_offset_to_lsp(text, 6), Some((0, 2)));
    }

    #[test]
    fn end_of_line_and_file() {
        let text = "ab\ncd";
        // End of line 0 (after 'b'): byte 2, col 2
        assert_eq!(lsp_to_byte_offset(text, 0, 2), Some(2));
        // End of file: byte 5, line 1 col 2
        assert_eq!(byte_offset_to_lsp(text, 5), Some((1, 2)));
        assert_eq!(lsp_to_byte_offset(text, 1, 2), Some(5));
    }

    #[test]
    fn crlf() {
        let text = "ab\r\ncd";
        // Line 0: "ab\r", but \r is before \n
        // 'c' should be at line 1 col 0 = byte 4
        assert_eq!(lsp_to_byte_offset(text, 1, 0), Some(4));
        assert_eq!(byte_offset_to_lsp(text, 4), Some((1, 0)));
    }

    #[test]
    fn empty_text() {
        let text = "";
        assert_eq!(byte_offset_to_lsp(text, 0), Some((0, 0)));
        assert_eq!(lsp_to_byte_offset(text, 0, 0), Some(0));
    }

    #[test]
    fn out_of_bounds() {
        let text = "abc";
        assert_eq!(byte_offset_to_lsp(text, 4), None);
        // Beyond end of line snaps to end
        assert_eq!(lsp_to_byte_offset(text, 0, 10), Some(3));
    }
}
