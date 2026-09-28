// Apply a list of LSP TextEdits to a String.
// Sorts descending by start position, checks for overlaps, applies in reverse order.

use super::pos;

/// A text edit with LSP positions (line, UTF-16 character).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct TextEdit {
    pub start_line: u32,
    pub start_character: u32,
    pub end_line: u32,
    pub end_character: u32,
    pub new_text: String,
}

impl TextEdit {
    pub fn from_lsp(edit: &lsp_types::TextEdit) -> Self {
        Self {
            start_line: edit.range.start.line,
            start_character: edit.range.start.character,
            end_line: edit.range.end.line,
            end_character: edit.range.end.character,
            new_text: edit.new_text.clone(),
        }
    }
}

/// Apply a list of TextEdits to a string. Returns the modified string,
/// or an error if any edits overlap.
pub fn apply_edits(text: &str, edits: &[TextEdit]) -> Result<String, EditError> {
    if edits.is_empty() {
        return Ok(text.to_string());
    }

    // Resolve to byte offsets
    let mut resolved: Vec<(usize, usize, &str)> = Vec::with_capacity(edits.len());
    for edit in edits {
        let start = pos::lsp_to_byte_offset(text, edit.start_line, edit.start_character)
            .ok_or(EditError::OutOfBounds)?;
        let end = pos::lsp_to_byte_offset(text, edit.end_line, edit.end_character)
            .ok_or(EditError::OutOfBounds)?;
        if start > end {
            return Err(EditError::OutOfBounds);
        }
        resolved.push((start, end, edit.new_text.as_str()));
    }

    // Sort descending by start, then by end (descending) for stability
    resolved.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)));

    // Check for overlaps: since sorted descending, each edit's range should not
    // overlap with the next one (which has a smaller or equal start).
    for i in 0..resolved.len() - 1 {
        let (start_a, _end_a, _) = resolved[i];
        let (_start_b, end_b, _) = resolved[i + 1];
        if end_b > start_a {
            return Err(EditError::Overlapping);
        }
    }

    // Apply in reverse (descending start) order so byte offsets stay valid
    let mut result = text.to_string();
    for (start, end, new_text) in &resolved {
        result.replace_range(*start..*end, new_text);
    }

    Ok(result)
}

/// Apply a list of TextEdits to a file on disk.
pub fn apply_to_file(path: &std::path::Path, edits: &[TextEdit]) -> Result<(), EditError> {
    let content = std::fs::read_to_string(path).map_err(|e| EditError::Io(e.to_string()))?;
    let new_content = apply_edits(&content, edits)?;
    std::fs::write(path, new_content).map_err(|e| EditError::Io(e.to_string()))?;
    Ok(())
}

#[derive(Debug, PartialEq)]
pub enum EditError {
    OutOfBounds,
    Overlapping,
    Io(String),
}

impl std::fmt::Display for EditError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EditError::OutOfBounds => write!(f, "edit position out of bounds"),
            EditError::Overlapping => write!(f, "overlapping edits"),
            EditError::Io(msg) => write!(f, "io error: {msg}"),
        }
    }
}

impl std::error::Error for EditError {}

#[cfg(test)]
mod tests {
    use super::*;

    fn edit(sl: u32, sc: u32, el: u32, ec: u32, text: &str) -> TextEdit {
        TextEdit {
            start_line: sl,
            start_character: sc,
            end_line: el,
            end_character: ec,
            new_text: text.to_string(),
        }
    }

    #[test]
    fn single_replace() {
        let text = "hello world";
        let edits = vec![edit(0, 6, 0, 11, "rust")];
        assert_eq!(apply_edits(text, &edits).unwrap(), "hello rust");
    }

    #[test]
    fn multi_edit_one_line() {
        let text = "abcdef";
        let edits = vec![
            edit(0, 0, 0, 1, "X"),  // a -> X
            edit(0, 4, 0, 5, "Y"),  // e -> Y
        ];
        assert_eq!(apply_edits(text, &edits).unwrap(), "XbcdYf");
    }

    #[test]
    fn insert_and_delete() {
        let text = "hello world";
        let edits = vec![
            edit(0, 5, 0, 6, ""),     // delete space
            edit(0, 0, 0, 0, "Hey "), // insert at start
        ];
        assert_eq!(apply_edits(text, &edits).unwrap(), "Hey helloworld");
    }

    #[test]
    fn random_input_order() {
        // Edits given in random order should still apply correctly
        let text = "abcdef";
        let edits = vec![
            edit(0, 4, 0, 5, "E"), // e -> E (later position, listed first)
            edit(0, 1, 0, 2, "B"), // b -> B (earlier position, listed second)
        ];
        assert_eq!(apply_edits(text, &edits).unwrap(), "aBcdEf");
    }

    #[test]
    fn edit_at_end_of_file() {
        let text = "abc";
        let edits = vec![edit(0, 3, 0, 3, "def")]; // insert at end
        assert_eq!(apply_edits(text, &edits).unwrap(), "abcdef");
    }

    #[test]
    fn multiline_edit() {
        let text = "line1\nline2\nline3";
        let edits = vec![edit(0, 3, 1, 3, "XY")]; // replace "e1\nlin" with "XY"
        assert_eq!(apply_edits(text, &edits).unwrap(), "linXYe2\nline3");
    }

    #[test]
    fn overlap_errors() {
        let text = "abcdef";
        let edits = vec![
            edit(0, 1, 0, 4, "X"),
            edit(0, 2, 0, 5, "Y"), // overlaps with previous
        ];
        assert_eq!(apply_edits(text, &edits), Err(EditError::Overlapping));
    }

    #[test]
    fn adjacent_edits_ok() {
        // Adjacent (touching) edits should not be considered overlapping
        let text = "abcdef";
        let edits = vec![
            edit(0, 0, 0, 3, "X"), // abc -> X
            edit(0, 3, 0, 6, "Y"), // def -> Y
        ];
        assert_eq!(apply_edits(text, &edits).unwrap(), "XY");
    }

    #[test]
    fn empty_edits() {
        let text = "hello";
        assert_eq!(apply_edits(text, &[]).unwrap(), "hello");
    }

    #[test]
    fn test_apply_to_file() {
        let tmp = tempfile::tempdir().unwrap();
        let file_path = tmp.path().join("test.txt");
        std::fs::write(&file_path, "hello world").unwrap();
        let edits = vec![edit(0, 6, 0, 11, "petak")];
        apply_to_file(&file_path, &edits).unwrap();
        let result = std::fs::read_to_string(&file_path).unwrap();
        assert_eq!(result, "hello petak");
    }
}
