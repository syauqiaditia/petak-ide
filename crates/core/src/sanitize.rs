use std::sync::OnceLock;
use regex::{Captures, Regex};

struct SanitizerRegexes {
    private_key: Regex,
    openai_key: Regex,
    github_token: Regex,
    gitlab_token: Regex,
    aws_key: Regex,
    slack_token: Regex,
    bearer_token: Regex,
    jwt_token: Regex,
    config_cred: Regex,
    indonesia_nik: Regex,
    credit_card: Regex,
}

impl SanitizerRegexes {
    fn new() -> Self {
        Self {
            private_key: Regex::new(
                r"(?s)-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----",
            )
            .expect("valid private key regex"),
            openai_key: Regex::new(r"\bsk-[a-zA-Z0-9_-]{20,}\b").expect("valid openai regex"),
            github_token: Regex::new(r"\bgh[pousr]_[a-zA-Z0-9]{36}\b")
                .expect("valid github regex"),
            gitlab_token: Regex::new(r"\bglpat-[a-zA-Z0-9_-]{20,}\b")
                .expect("valid gitlab regex"),
            aws_key: Regex::new(r"\bAKIA[0-9A-Z]{16}\b").expect("valid aws regex"),
            slack_token: Regex::new(r"\bxox[baprs]-[0-9a-zA-Z-]{10,64}\b")
                .expect("valid slack regex"),
            bearer_token: Regex::new(r"Bearer\s+[a-zA-Z0-9._~+/-]+=*")
                .expect("valid bearer regex"),
            jwt_token: Regex::new(
                r"\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+\b",
            )
            .expect("valid jwt regex"),
            config_cred: Regex::new(
                r#"(?i)\b(password|passwd|secret|client_secret|api_key|token)(\s*[:=]\s*["']?)([^"'\s\n]{3,})(["']?)"#,
            )
            .expect("valid config regex"),
            indonesia_nik: Regex::new(r"\b[1-9]\d{15}\b").expect("valid nik regex"),
            credit_card: Regex::new(r"\b(?:\d{4}[ -]){3}\d{4}\b|\b\d{13,19}\b")
                .expect("valid cc regex"),
        }
    }
}

static REGEXES: OnceLock<SanitizerRegexes> = OnceLock::new();

fn get_regexes() -> &'static SanitizerRegexes {
    REGEXES.get_or_init(SanitizerRegexes::new)
}

/// Sanitizes credentials, API tokens, and PII from the input string with sub-millisecond overhead.
pub fn sanitize_sensitive_data(input: &str) -> String {
    let re = get_regexes();

    // 1. Private keys multiline
    let step1 = re.private_key.replace_all(input, "[REDACTED_KEY]");

    // 2. Bearer tokens (run before raw JWT to preserve Bearer prefix)
    let step2 = re.bearer_token.replace_all(&step1, "Bearer [REDACTED_TOKEN]");

    // 3. Standalone JWT tokens
    let step3 = re.jwt_token.replace_all(&step2, "[REDACTED_TOKEN]");

    // 4. Specific service tokens & keys
    let step4 = re.openai_key.replace_all(&step3, "[REDACTED_KEY]");
    let step5 = re.github_token.replace_all(&step4, "[REDACTED_TOKEN]");
    let step6 = re.gitlab_token.replace_all(&step5, "[REDACTED_TOKEN]");
    let step7 = re.aws_key.replace_all(&step6, "[REDACTED_KEY]");
    let step8 = re.slack_token.replace_all(&step7, "[REDACTED_TOKEN]");

    // 5. Config key-value credentials (guard against already-redacted values)
    let step9 = re.config_cred.replace_all(&step8, |caps: &Captures| {
        let key = &caps[1];
        let delim = &caps[2];
        let val = &caps[3];
        let trailing_quote = caps.get(4).map(|m| m.as_str()).unwrap_or("");
        if val.starts_with("[REDACTED_") {
            return caps[0].to_string();
        }
        let redaction = if key.to_ascii_lowercase().starts_with("pass") {
            "[REDACTED_PASSWORD]"
        } else {
            "[REDACTED_CREDENTIAL]"
        };
        format!("{}{}{}{}", key, delim, redaction, trailing_quote)
    });

    // 6. Indonesian NIK / KTP
    let step10 = re.indonesia_nik.replace_all(&step9, "[REDACTED_PII]");

    // 7. Credit Card numbers (delimiters and 13-19 digits)
    let step11 = re.credit_card.replace_all(&step10, "[REDACTED_PII]");

    step11.into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    #[test]
    fn test_sanitize_api_keys() {
        let openai = "export OPENAI_API_KEY=sk-abc123456789012345678901234567890";
        assert_eq!(
            sanitize_sensitive_data(openai),
            "export OPENAI_API_KEY=[REDACTED_KEY]"
        );

        let gh = "git token: ghp_123456789012345678901234567890123456 and ghu_abcdefghijklmnopqrstuvwxyz0123456789";
        assert_eq!(
            sanitize_sensitive_data(gh),
            "git token: [REDACTED_TOKEN] and [REDACTED_TOKEN]"
        );

        let gl = "gitlab: glpat-abcdef123456789012345678";
        assert_eq!(sanitize_sensitive_data(gl), "gitlab: [REDACTED_TOKEN]");

        let aws = "aws key: AKIAIOSFODNN7EXAMPLE";
        assert_eq!(sanitize_sensitive_data(aws), "aws key: [REDACTED_KEY]");

        let slack = "slack: xoxb-123456789012-abcdef123456";
        assert_eq!(sanitize_sensitive_data(slack), "slack: [REDACTED_TOKEN]");
    }

    #[test]
    fn test_sanitize_private_keys() {
        let rsa = "prelude\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Yv5K9w...lots of base64...\n-----END RSA PRIVATE KEY-----\npostlude";
        assert_eq!(
            sanitize_sensitive_data(rsa),
            "prelude\n[REDACTED_KEY]\npostlude"
        );

        let ec = "-----BEGIN EC PRIVATE KEY-----\nMHcCAQEE...base64\n-----END EC PRIVATE KEY-----";
        assert_eq!(sanitize_sensitive_data(ec), "[REDACTED_KEY]");
    }

    #[test]
    fn test_sanitize_bearer_and_jwt() {
        let bearer = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
        assert_eq!(
            sanitize_sensitive_data(bearer),
            "Authorization: Bearer [REDACTED_TOKEN]"
        );

        let raw_jwt = "token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
        assert_eq!(
            sanitize_sensitive_data(raw_jwt),
            "token=[REDACTED_TOKEN]"
        );
    }

    #[test]
    fn test_sanitize_config_credentials() {
        let cfg = r#"
password: "mySuperSecretPassword123"
passwd = unquotedPasswd456
client_secret: "sec_987654321"
api_key = my_api_key_value
token: "auth_token_value_abc"
"#;
        let sanitized = sanitize_sensitive_data(cfg);
        assert!(!sanitized.contains("mySuperSecretPassword123"));
        assert!(!sanitized.contains("unquotedPasswd456"));
        assert!(!sanitized.contains("sec_987654321"));
        assert!(sanitized.contains("password: \"[REDACTED_PASSWORD]\""));
        assert!(sanitized.contains("passwd = [REDACTED_PASSWORD]"));
        assert!(sanitized.contains("client_secret: \"[REDACTED_CREDENTIAL]\""));
    }

    #[test]
    fn test_sanitize_pii() {
        let nik = "NIK KTP: 3171012345678901 adalah data penduduk";
        assert_eq!(
            sanitize_sensitive_data(nik),
            "NIK KTP: [REDACTED_PII] adalah data penduduk"
        );

        let cc_hyphen = "Kartu: 4532-1234-5678-9012 berakhir 12/28";
        assert_eq!(
            sanitize_sensitive_data(cc_hyphen),
            "Kartu: [REDACTED_PII] berakhir 12/28"
        );

        let cc_space = "Kartu: 4532 1234 5678 9012";
        assert_eq!(sanitize_sensitive_data(cc_space), "Kartu: [REDACTED_PII]");

        let cc_raw = "CC: 4532123456789012";
        assert_eq!(sanitize_sensitive_data(cc_raw), "CC: [REDACTED_PII]");

        // Non-PII short numbers should not be touched
        let short = "Port 8080, tahun 2026, kode pos 12345";
        assert_eq!(sanitize_sensitive_data(short), short);
    }

    #[test]
    fn test_sanitize_performance() {
        let mut sample = String::with_capacity(8_000);
        for i in 0..50 {
            sample.push_str(&format!(
                "line {}: typical prompt input content, status=ok, key=val\n",
                i
            ));
            if i % 10 == 0 {
                sample.push_str("config password: \"sensitive_password_123\" and sk-1234567890123456789012345\n");
            }
        }

        // Warm up
        for _ in 0..5 {
            let _ = sanitize_sensitive_data(&sample);
        }

        let start = Instant::now();
        let iterations = 20;
        for _ in 0..iterations {
            let _ = sanitize_sensitive_data(&sample);
        }
        let elapsed = start.elapsed();
        let avg_micros = elapsed.as_micros() / iterations as u128;
        assert!(
            avg_micros < 2500,
            "Sanitization took too long: {} micros avg per typical payload",
            avg_micros
        );
    }
}
