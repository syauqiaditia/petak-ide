use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageReport {
    pub reported: bool,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
    pub cost: Option<f64>,
    pub context_percentage: Option<f64>,
    pub display_text: String,
    pub raw: Option<Value>,
}

pub fn parse_usage(usage_val: Option<&Value>, meta_val: Option<&Value>) -> UsageReport {
    let source = match (usage_val, meta_val) {
        (Some(u), _) if !u.is_null() => Some(u),
        (_, Some(m)) if !m.is_null() => {
            if let Some(u) = m.get("usage") {
                Some(u)
            } else {
                Some(m)
            }
        }
        _ => None,
    };

    let obj = match source {
        Some(v) => v,
        None => {
            return UsageReport {
                reported: false,
                display_text: "tidak melapor".to_string(),
                ..Default::default()
            };
        }
    };

    let input_tokens = obj
        .get("inputTokens")
        .or_else(|| obj.get("input_tokens"))
        .or_else(|| obj.get("prompt_tokens"))
        .and_then(|v| v.as_u64());

    let output_tokens = obj
        .get("outputTokens")
        .or_else(|| obj.get("output_tokens"))
        .or_else(|| obj.get("completion_tokens"))
        .and_then(|v| v.as_u64());

    let total_tokens = obj
        .get("totalTokens")
        .or_else(|| obj.get("total_tokens"))
        .and_then(|v| v.as_u64())
        .or_else(|| match (input_tokens, output_tokens) {
            (Some(i), Some(o)) => Some(i + o),
            _ => None,
        });

    let cost = obj
        .get("cost")
        .or_else(|| obj.get("totalCost"))
        .or_else(|| obj.get("total_cost"))
        .and_then(|v| v.as_f64());

    let context_percentage = obj
        .get("contextPercentage")
        .or_else(|| obj.get("context_percentage"))
        .or_else(|| obj.get("context_pct"))
        .and_then(|v| v.as_f64());

    let reported = input_tokens.is_some()
        || output_tokens.is_some()
        || total_tokens.is_some()
        || cost.is_some()
        || context_percentage.is_some();

    if !reported {
        return UsageReport {
            reported: false,
            display_text: "tidak melapor".to_string(),
            raw: Some(obj.clone()),
            ..Default::default()
        };
    }

    let mut parts = Vec::new();
    if let (Some(i), Some(o)) = (input_tokens, output_tokens) {
        parts.push(format!("{i} in / {o} out"));
    } else if let Some(t) = total_tokens {
        parts.push(format!("{t} token"));
    }

    if let Some(c) = cost {
        parts.push(format!("${c:.4}"));
    }

    if let Some(pct) = context_percentage {
        parts.push(format!("{pct:.1}% ctx"));
    }

    let display_text = if parts.is_empty() {
        "tidak melapor".to_string()
    } else {
        parts.join(" · ")
    };

    UsageReport {
        reported: true,
        input_tokens,
        output_tokens,
        total_tokens,
        cost,
        context_percentage,
        display_text,
        raw: Some(obj.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_usage_reported_and_unreported() {
        // 1. None returns "tidak melapor"
        let r1 = parse_usage(None, None);
        assert!(!r1.reported);
        assert_eq!(r1.display_text, "tidak melapor");

        // 2. Empty json returns "tidak melapor"
        let empty = serde_json::json!({});
        let r2 = parse_usage(Some(&empty), None);
        assert!(!r2.reported);
        assert_eq!(r2.display_text, "tidak melapor");

        // 3. Valid usage parsed properly
        let val = serde_json::json!({
            "inputTokens": 15,
            "outputTokens": 7,
            "cost": 0.0025,
            "contextPercentage": 4.5
        });
        let r3 = parse_usage(Some(&val), None);
        assert!(r3.reported);
        assert_eq!(r3.input_tokens, Some(15));
        assert_eq!(r3.output_tokens, Some(7));
        assert_eq!(r3.total_tokens, Some(22));
        assert_eq!(r3.cost, Some(0.0025));
        assert_eq!(r3.context_percentage, Some(4.5));
        assert!(r3.display_text.contains("15 in / 7 out"));
        assert!(r3.display_text.contains("$0.0025"));
        assert!(r3.display_text.contains("4.5% ctx"));
    }
}
