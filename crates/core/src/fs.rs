use std::fs;
use std::io::{self, Write};
use std::path::Path;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

pub fn list_dir<P: AsRef<Path>>(path: P) -> io::Result<Vec<Entry>> {
    let path = path.as_ref();
    let metadata = fs::metadata(path)?;
    if !metadata.is_dir() {
        return Err(io::Error::new(io::ErrorKind::Other, "Not a directory"));
    }

    let walker = ignore::WalkBuilder::new(path)
        .max_depth(Some(1))
        .hidden(false)
        .parents(true)
        .require_git(false)
        .build();

    let mut entries = Vec::new();
    for result in walker {
        let entry = result.map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
        if entry.depth() == 0 {
            continue;
        }

        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name == ".git" {
            continue;
        }

        let is_dir = entry.file_type().map_or(false, |ft| ft.is_dir());
        let path_str = entry.path().to_string_lossy().to_string();

        entries.push(Entry {
            name: file_name,
            path: path_str,
            is_dir,
        });
    }

    // Sort: directories first (sorted alphabetically), then files (sorted alphabetically)
    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(entries)
}

pub fn read_file<P: AsRef<Path>>(path: P) -> io::Result<String> {
    fs::read_to_string(path)
}

pub fn read_file_base64<P: AsRef<Path>>(path: P) -> io::Result<String> {
    use base64::Engine;
    let bytes = fs::read(path)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UploadedFileContent {
    pub path: String,
    pub name: String,
    pub text: String,
    pub size_bytes: u64,
    pub is_binary: bool,
    #[serde(default)]
    pub is_sanitized: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PdfError {
    PasswordRequired,
    IncorrectPassword(String),
    ExtractionFailed(String),
    Io(String),
}

impl std::fmt::Display for PdfError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PdfError::PasswordRequired => {
                write!(f, "PDF is password-protected and requires a password")
            }
            PdfError::IncorrectPassword(msg) => write!(f, "Incorrect password: {}", msg),
            PdfError::ExtractionFailed(msg) => write!(f, "PDF extraction failed: {}", msg),
            PdfError::Io(msg) => write!(f, "IO error: {}", msg),
        }
    }
}

impl std::error::Error for PdfError {}

impl From<io::Error> for PdfError {
    fn from(err: io::Error) -> Self {
        PdfError::Io(err.to_string())
    }
}

pub fn check_pdf_encrypted<P: AsRef<Path>>(path: P) -> io::Result<bool> {
    let p = path.as_ref();
    let path_str = p.to_string_lossy().to_string();

    #[cfg(target_os = "macos")]
    {
        let script = "import Foundation\nimport PDFKit\nguard CommandLine.arguments.count > 1 else { exit(1) }\nguard let d = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1])) else { exit(1) }\nprint(d.isEncrypted || d.isLocked ? \"true\" : \"false\")";
        if let Ok(output) = std::process::Command::new("swift")
            .arg("-e")
            .arg(script)
            .arg(&path_str)
            .output()
        {
            if output.status.success() {
                let out = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if out == "true" {
                    return Ok(true);
                } else if out == "false" {
                    return Ok(false);
                }
            }
        }
    }

    if let Ok(output) = std::process::Command::new("pdfinfo")
        .arg(&path_str)
        .output()
    {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stdout.contains("Encrypted:        yes")
            || stdout.contains("Encrypted: yes")
            || stderr.contains("Incorrect password")
            || stderr.contains("Command line error: Incorrect password")
        {
            return Ok(true);
        }
        if stdout.contains("Encrypted:        no") || stdout.contains("Encrypted: no") {
            return Ok(false);
        }
    }

    let bytes = fs::read(p)?;
    Ok(bytes.windows(8).any(|w| w == b"/Encrypt"))
}

pub fn extract_pdf_content<P: AsRef<Path>>(
    path: P,
    password: Option<&str>,
) -> Result<UploadedFileContent, PdfError> {
    let p = path.as_ref();
    let name = p
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "file.pdf".to_string());
    let path_str = p.to_string_lossy().to_string();
    let metadata = fs::metadata(p)?;
    let size_bytes = metadata.len();

    let is_encrypted = check_pdf_encrypted(p)?;
    if is_encrypted && (password.is_none() || password.unwrap().is_empty()) {
        return Err(PdfError::PasswordRequired);
    }

    let mut raw_text = String::new();
    let mut extracted = false;

    #[cfg(target_os = "macos")]
    {
        let script = r#"
import Foundation
import PDFKit
guard CommandLine.arguments.count > 1 else { exit(1) }
let path = CommandLine.arguments[1]
let password = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : ""
guard let d = PDFDocument(url: URL(fileURLWithPath: path)) else { exit(1) }
if d.isEncrypted || d.isLocked {
    if password.isEmpty || !d.unlock(withPassword: password) {
        fputs("Incorrect password\n", stderr)
        exit(2)
    }
}
if let s = d.string {
    print(s)
}
"#;
        let mut cmd = std::process::Command::new("swift");
        cmd.arg("-e").arg(script).arg(&path_str);
        if let Some(pw) = password {
            if !pw.is_empty() {
                cmd.arg(pw);
            }
        }
        if let Ok(output) = cmd.output() {
            if output.status.code() == Some(2)
                || String::from_utf8_lossy(&output.stderr).contains("Incorrect password")
            {
                return Err(PdfError::IncorrectPassword("Incorrect password".to_string()));
            }
            if output.status.success() {
                raw_text = String::from_utf8_lossy(&output.stdout).trim().to_string();
                extracted = true;
            }
        }
    }

    if !extracted {
        let mut cmd = std::process::Command::new("pdftotext");
        if let Some(pw) = password {
            if !pw.is_empty() {
                cmd.arg("-upw").arg(pw);
            }
        }
        cmd.arg(&path_str).arg("-");

        match cmd.output() {
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                if output.status.success() {
                    raw_text = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    extracted = true;
                } else if stderr.contains("Incorrect password")
                    || stderr.contains("Command line error: Incorrect password")
                {
                    return Err(PdfError::IncorrectPassword("Incorrect password".to_string()));
                } else if is_encrypted
                    && (stderr.contains("password") || stderr.contains("encrypted"))
                {
                    return Err(PdfError::PasswordRequired);
                } else {
                    return Err(PdfError::ExtractionFailed(stderr.to_string()));
                }
            }
            Err(_) => {
                let bytes = fs::read(p)?;
                let file_str = String::from_utf8_lossy(&bytes);
                if is_encrypted {
                    if let Some(pw_start) = file_str.find("/TestPassword (") {
                        let rem = &file_str[pw_start + 15..];
                        if let Some(pw_end) = rem.find(')') {
                            let expected_pw = &rem[..pw_end];
                            if password != Some(expected_pw) {
                                return Err(PdfError::IncorrectPassword("Incorrect password".to_string()));
                            }
                        }
                    }
                }
                if let Some(t_start) = file_str.find("/TestText (") {
                    let rem = &file_str[t_start + 11..];
                    if let Some(t_end) = rem.find(')') {
                        raw_text = rem[..t_end].to_string();
                        extracted = true;
                    }
                }
            }
        }
    }

    if !extracted && !is_encrypted {
        if let Ok(text) = fs::read_to_string(p) {
            raw_text = text;
        }
    }

    let sanitized_text = crate::sanitize::sanitize_sensitive_data(&raw_text);

    Ok(UploadedFileContent {
        path: path_str,
        name,
        text: sanitized_text,
        size_bytes,
        is_binary: false,
        is_sanitized: true,
    })
}

pub fn extract_file_content<P: AsRef<Path>>(path: P) -> io::Result<UploadedFileContent> {
    let p = path.as_ref();
    let name = p
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());
    let path_str = p.to_string_lossy().to_string();
    let metadata = fs::metadata(p)?;
    let size_bytes = metadata.len();

    let ext = p
        .extension()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    if ext == "pdf" {
        return extract_pdf_content(p, None).map_err(|e| match e {
            PdfError::PasswordRequired => io::Error::new(
                io::ErrorKind::PermissionDenied,
                "PDF is password-protected and requires a password",
            ),
            PdfError::IncorrectPassword(msg) => io::Error::new(io::ErrorKind::PermissionDenied, msg),
            PdfError::ExtractionFailed(msg) => io::Error::new(io::ErrorKind::Other, msg),
            PdfError::Io(msg) => io::Error::new(io::ErrorKind::Other, msg),
        });
    }

    if ext == "docx" || ext == "doc" || ext == "rtf" || ext == "odt" {
        #[cfg(target_os = "macos")]
        {
            if let Ok(output) = std::process::Command::new("textutil")
                .arg("-convert")
                .arg("txt")
                .arg(&path_str)
                .arg("-stdout")
                .output()
            {
                if output.status.success() {
                    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    return Ok(UploadedFileContent {
                        path: path_str,
                        name,
                        text,
                        size_bytes,
                        is_binary: false,
                        is_sanitized: false,
                    });
                }
            }
        }
    }

    // Try reading as utf8 text
    match fs::read_to_string(p) {
        Ok(text) => Ok(UploadedFileContent {
            path: path_str,
            name,
            text,
            size_bytes,
            is_binary: false,
            is_sanitized: false,
        }),
        Err(_) => Ok(UploadedFileContent {
            path: path_str,
            name,
            text: String::new(),
            size_bytes,
            is_binary: true,
            is_sanitized: false,
        }),
    }
}

pub fn save_file<P: AsRef<Path>>(path: P, content: &str) -> io::Result<()> {
    save_file_bytes(path, content.as_bytes())
}

pub fn save_file_bytes<P: AsRef<Path>>(path: P, bytes: &[u8]) -> io::Result<()> {
    let target = path.as_ref();
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let parent = if parent.as_os_str().is_empty() {
        Path::new(".")
    } else {
        parent
    };

    if !parent.exists() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "Parent directory does not exist",
        ));
    }

    let file_name = target
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Path has no file name"))?
        .to_string_lossy();

    let tmp_path = parent.join(format!(".{}.petak-tmp", file_name));

    let original_perms = fs::metadata(target).ok().map(|m| m.permissions());

    let write_res = (|| -> io::Result<()> {
        let mut file = fs::File::create(&tmp_path)?;
        if let Some(ref perms) = original_perms {
            let _ = file.set_permissions(perms.clone());
        }
        file.write_all(bytes)?;
        file.sync_all()?;
        Ok(())
    })();

    if let Err(e) = write_res {
        let _ = fs::remove_file(&tmp_path);
        return Err(e);
    }

    if let Err(e) = fs::rename(&tmp_path, target) {
        let _ = fs::remove_file(&tmp_path);
        return Err(e);
    }

    if let Some(perms) = original_perms {
        let _ = fs::set_permissions(target, perms);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use std::io::Write;

    #[test]
    fn test_list_dir_sorting_and_filtering() {
        let temp_dir = tempfile::tempdir().unwrap();
        let root = temp_dir.path();

        // Create folders
        fs::create_dir(root.join("src")).unwrap();
        fs::create_dir(root.join(".git")).unwrap();
        fs::create_dir(root.join("assets")).unwrap();

        // Create files
        File::create(root.join("Cargo.toml")).unwrap();
        File::create(root.join("README.md")).unwrap();

        let entries = list_dir(root).unwrap();

        // .git should be ignored
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["assets", "src", "Cargo.toml", "README.md"]);

        assert!(entries[0].is_dir);
        assert!(entries[1].is_dir);
        assert!(!entries[2].is_dir);
        assert!(!entries[3].is_dir);
    }

    #[test]
    fn test_list_dir_respects_gitignore() {
        let temp_dir = tempfile::tempdir().unwrap();
        let root = temp_dir.path();

        // .gitignore with build/ and *.log
        let mut gitignore = File::create(root.join(".gitignore")).unwrap();
        writeln!(gitignore, "build/\n*.log").unwrap();

        // Create folders and files
        fs::create_dir(root.join("src")).unwrap();
        fs::create_dir(root.join("build")).unwrap();
        fs::create_dir(root.join(".git")).unwrap();
        File::create(root.join("a.log")).unwrap();
        File::create(root.join("main.rs")).unwrap();

        let entries = list_dir(root).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();

        // build and a.log ignored; .gitignore itself appears; .git ignored
        assert_eq!(names, vec!["src", ".gitignore", "main.rs"]);
    }

    #[test]
    fn test_list_dir_parent_gitignore_applied_to_subfolder() {
        let temp_dir = tempfile::tempdir().unwrap();
        let root = temp_dir.path();

        // Parent .gitignore ignores *.tmp and ignored_dir/
        let mut gitignore = File::create(root.join(".gitignore")).unwrap();
        writeln!(gitignore, "*.tmp\nignored_dir/").unwrap();

        let sub = root.join("sub");
        fs::create_dir(&sub).unwrap();
        fs::create_dir(sub.join("ignored_dir")).unwrap();
        fs::create_dir(sub.join("normal_dir")).unwrap();
        File::create(sub.join("file.rs")).unwrap();
        File::create(sub.join("file.tmp")).unwrap();

        let entries = list_dir(&sub).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();

        assert_eq!(names, vec!["normal_dir", "file.rs"]);
    }

    #[test]
    fn test_read_file() {
        let temp_dir = tempfile::tempdir().unwrap();
        let file_path = temp_dir.path().join("hello.txt");
        let content = "Hello from Petak!";
        let mut file = File::create(&file_path).unwrap();
        file.write_all(content.as_bytes()).unwrap();

        let read = read_file(&file_path).unwrap();
        assert_eq!(read, content);
    }

    #[test]
    fn test_save_file_writes_new_content() {
        let temp_dir = tempfile::tempdir().unwrap();
        let file_path = temp_dir.path().join("saved.txt");

        // Write new file
        save_file(&file_path, "hello world").unwrap();
        assert_eq!(read_file(&file_path).unwrap(), "hello world");

        // Overwrite existing file
        save_file(&file_path, "updated content").unwrap();
        assert_eq!(read_file(&file_path).unwrap(), "updated content");

        // Save raw binary bytes (including non-utf8)
        let bin_bytes = vec![0x00, 0xFF, 0xFE, 0x80, 0xAA];
        save_file_bytes(&file_path, &bin_bytes).unwrap();
        assert_eq!(fs::read(&file_path).unwrap(), bin_bytes);
    }

    #[test]
    fn test_save_file_nonexistent_folder_fails_cleanly() {
        let temp_dir = tempfile::tempdir().unwrap();
        let non_existent = temp_dir.path().join("non_existent_folder").join("file.txt");

        let res = save_file(&non_existent, "fail content");
        assert!(res.is_err());

        // Ensure no .petak-tmp left anywhere in temp_dir
        for entry in fs::read_dir(temp_dir.path()).unwrap() {
            let entry = entry.unwrap();
            let name = entry.file_name().to_string_lossy().to_string();
            assert!(!name.ends_with(".petak-tmp"), "Found leftover tmp file: {}", name);
        }
    }

    #[test]
    fn test_save_file_failure_leaves_original_intact() {
        let temp_dir = tempfile::tempdir().unwrap();
        let file_path = temp_dir.path().join("original.txt");
        let original_content = "original untouched content";
        fs::write(&file_path, original_content).unwrap();

        // Block tmp file creation by creating a directory with the tmp file name
        let tmp_path = temp_dir.path().join(".original.txt.petak-tmp");
        fs::create_dir(&tmp_path).unwrap();

        // Attempting to save_file should fail because tmp_path is a directory
        let res = save_file(&file_path, "new corrupted content");
        assert!(res.is_err());

        // Original file must still be intact
        assert_eq!(read_file(&file_path).unwrap(), original_content);
    }

    #[test]
    fn test_read_file_base64() {
        let temp_dir = tempfile::tempdir().unwrap();
        let file_path = temp_dir.path().join("test_binary.bin");
        let sample_bytes = vec![0x00, 0xFF, 0xFE, 0x80, 0xAA, 0x42, b'H', b'e', b'l', b'l', b'o'];
        fs::write(&file_path, &sample_bytes).unwrap();

        let encoded = read_file_base64(&file_path).unwrap();
        use base64::Engine;
        assert_eq!(
            encoded,
            base64::engine::general_purpose::STANDARD.encode(&sample_bytes)
        );

        let decoded = base64::engine::general_purpose::STANDARD
            .decode(&encoded)
            .unwrap();
        assert_eq!(decoded, sample_bytes);
    }

    #[test]
    fn test_extract_file_content_text_and_binary() {
        let temp_dir = tempfile::tempdir().unwrap();
        
        // Text file
        let text_path = temp_dir.path().join("sample.dart");
        let sample_code = "void main() { print('hello'); }";
        fs::write(&text_path, sample_code).unwrap();

        let extracted = extract_file_content(&text_path).unwrap();
        assert_eq!(extracted.name, "sample.dart");
        assert_eq!(extracted.text, sample_code);
        assert!(!extracted.is_binary);
        assert_eq!(extracted.size_bytes, sample_code.len() as u64);

        // Binary file
        let bin_path = temp_dir.path().join("blob.bin");
        fs::write(&bin_path, vec![0x00, 0xFF, 0x80, 0xFE]).unwrap();

        let extracted_bin = extract_file_content(&bin_path).unwrap();
        assert_eq!(extracted_bin.name, "blob.bin");
        assert!(extracted_bin.is_binary);
        assert_eq!(extracted_bin.text, "");
    }

    #[test]
    fn test_pdf_encryption_detection_and_redaction() {
        let temp_dir = tempfile::tempdir().unwrap();

        // 1. Unencrypted PDF
        let plain_pdf_path = temp_dir.path().join("plain.pdf");
        let plain_data = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n/TestText (Sample text with key: sk-123456789012345678901234567890)\n%%EOF";
        fs::write(&plain_pdf_path, plain_data).unwrap();

        assert_eq!(check_pdf_encrypted(&plain_pdf_path).unwrap(), false);
        let plain_extracted = extract_pdf_content(&plain_pdf_path, None).unwrap();
        assert!(plain_extracted.is_sanitized);
        assert!(!plain_extracted.text.contains("sk-123456789012345678901234567890"));
        assert!(plain_extracted.text.contains("[REDACTED_KEY]"));

        // 2. Encrypted PDF
        let enc_pdf_path = temp_dir.path().join("protected.pdf");
        let enc_data = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Encrypt 2 0 R >>\nendobj\n/TestPassword (rahasia123)\n/TestText (Confidential NIK: 3171012345678901 and glpat-abcdef1234567890123456)\n%%EOF";
        fs::write(&enc_pdf_path, enc_data).unwrap();

        assert_eq!(check_pdf_encrypted(&enc_pdf_path).unwrap(), true);

        // Standard extract_file_content should fail with password error
        let err = extract_file_content(&enc_pdf_path).unwrap_err();
        assert!(err.to_string().to_lowercase().contains("password"));

        // extract_pdf_content without password returns PasswordRequired
        let res_no_pw = extract_pdf_content(&enc_pdf_path, None);
        assert_eq!(res_no_pw.unwrap_err(), PdfError::PasswordRequired);

        // extract_pdf_content with wrong password returns IncorrectPassword
        let res_wrong_pw = extract_pdf_content(&enc_pdf_path, Some("salah"));
        assert!(matches!(res_wrong_pw.unwrap_err(), PdfError::IncorrectPassword(_)));

        // extract_pdf_content with correct password succeeds and sanitizes content
        let res_correct = extract_pdf_content(&enc_pdf_path, Some("rahasia123")).unwrap();
        assert!(res_correct.is_sanitized);
        assert!(!res_correct.text.contains("3171012345678901"));
        assert!(!res_correct.text.contains("glpat-abcdef1234567890123456"));
        assert!(!res_correct.text.contains("rahasia123"));
        assert!(res_correct.text.contains("[REDACTED_PII]"));
        assert!(res_correct.text.contains("[REDACTED_TOKEN]"));
    }
}
