use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::exec::{git, Exec, GitError};
use crate::git::graph::layout;
use crate::git::model::{
    BranchList, Commit, GraphState, LocalBranch, LogFilter, LogPage, RefKind, RefLabel,
    RemoteBranch, TagRef,
};

/// Reads local branches, remote branches, and tags in a single git call.
pub fn branches(exec: &dyn Exec, repo: &Path) -> Result<BranchList, GitError> {
    let args = [
        "for-each-ref",
        "--format=%(refname)|%(HEAD)|%(refname:short)|%(objectname)|%(*objectname)|%(upstream:short)|%(upstream:track)",
        "refs/heads",
        "refs/remotes",
        "refs/tags",
    ];
    let output = git(exec, repo, &args)?;
    Ok(parse_branches_output(&output))
}

pub fn parse_branches_output(raw: &str) -> BranchList {
    let mut local = Vec::new();
    let mut remote = Vec::new();
    let mut tags = Vec::new();

    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let parts: Vec<&str> = line.split('|').collect();
        if parts.len() < 7 {
            continue;
        }

        let refname = parts[0];
        let head_flag = parts[1].trim();
        let short_name = parts[2].to_string();
        let objectname = parts[3].to_string();
        let peeled = parts[4].trim();
        let upstream = parts[5].trim();
        let track = parts[6].trim();

        if refname.starts_with("refs/heads/") {
            let is_current = head_flag == "*";
            let (ahead, behind) = parse_tracking(track);
            let upstream_opt = if upstream.is_empty() {
                None
            } else {
                Some(upstream.to_string())
            };
            local.push(LocalBranch {
                name: short_name,
                upstream: upstream_opt,
                ahead,
                behind,
                is_current,
                sha: objectname,
            });
        } else if refname.starts_with("refs/remotes/") {
            // Ignore symbolic HEAD (e.g. origin/HEAD)
            if !short_name.ends_with("/HEAD") {
                remote.push(RemoteBranch {
                    name: short_name,
                    sha: objectname,
                });
            }
        } else if refname.starts_with("refs/tags/") {
            let sha = if peeled.is_empty() {
                objectname
            } else {
                peeled.to_string()
            };
            tags.push(TagRef {
                name: short_name,
                sha,
            });
        }
    }

    BranchList {
        local,
        remote,
        tags,
    }
}

pub fn parse_tracking(track_str: &str) -> (u32, u32) {
    let mut ahead = 0;
    let mut behind = 0;
    let s = track_str
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']');
    for part in s.split(',') {
        let part = part.trim();
        if let Some(num_str) = part.strip_prefix("ahead ") {
            ahead = num_str.trim().parse().unwrap_or(0);
        } else if let Some(num_str) = part.strip_prefix("behind ") {
            behind = num_str.trim().parse().unwrap_or(0);
        }
    }
    (ahead, behind)
}

/// Gathers all refs (heads, remotes, tags, and HEAD) mapped by commit SHA.
/// Ignores `refs/petak/backup/*` from badge display.
pub fn get_refs_map(
    exec: &dyn Exec,
    repo: &Path,
) -> Result<HashMap<String, Vec<RefLabel>>, GitError> {
    let mut map: HashMap<String, Vec<RefLabel>> = HashMap::new();

    let args = [
        "for-each-ref",
        "--format=%(refname)|%(HEAD)|%(refname:short)|%(objectname)|%(*objectname)",
        "refs/heads",
        "refs/remotes",
        "refs/tags",
    ];
    let output = match git(exec, repo, &args) {
        Ok(out) => out,
        Err(_) => String::new(),
    };

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let parts: Vec<&str> = line.split('|').collect();
        if parts.len() < 5 {
            continue;
        }

        let refname = parts[0];
        let head_flag = parts[1].trim();
        let short_name = parts[2].to_string();
        let objectname = parts[3].trim().to_string();
        let peeled = parts[4].trim();

        // Ignore petak backup refs from badges
        if refname.starts_with("refs/petak/backup/") {
            continue;
        }

        if refname.starts_with("refs/heads/") {
            let is_current = head_flag == "*";
            map.entry(objectname).or_default().push(RefLabel {
                kind: RefKind::Branch,
                name: short_name,
                is_current,
            });
        } else if refname.starts_with("refs/remotes/") {
            if !short_name.ends_with("/HEAD") {
                map.entry(objectname).or_default().push(RefLabel {
                    kind: RefKind::Remote,
                    name: short_name,
                    is_current: false,
                });
            }
        } else if refname.starts_with("refs/tags/") {
            let sha = if peeled.is_empty() {
                objectname
            } else {
                peeled.to_string()
            };
            map.entry(sha).or_default().push(RefLabel {
                kind: RefKind::Tag,
                name: short_name,
                is_current: false,
            });
        }
    }

    // Include HEAD ref
    if let Ok(head_sha_raw) = git(exec, repo, &["rev-parse", "--verify", "HEAD"]) {
        let head_sha = head_sha_raw.trim();
        if !head_sha.is_empty() {
            let labels = map.entry(head_sha.to_string()).or_default();
            if !labels.iter().any(|l| l.kind == RefKind::Head) {
                labels.insert(
                    0,
                    RefLabel {
                        kind: RefKind::Head,
                        name: "HEAD".to_string(),
                        is_current: true,
                    },
                );
            }
        }
    }

    // Sort labels per commit: Head first, then current branch, other branches, remotes, tags
    for labels in map.values_mut() {
        labels.sort_by_key(|l| match l.kind {
            RefKind::Head => 0,
            RefKind::Branch if l.is_current => 1,
            RefKind::Branch => 2,
            RefKind::Remote => 3,
            RefKind::Tag => 4,
        });
    }

    Ok(map)
}

/// Returns a set of all commit SHAs reachable from any remote ref.
pub fn get_pushed_shas(exec: &dyn Exec, repo: &Path) -> Result<HashSet<String>, GitError> {
    let output = match git(exec, repo, &["rev-list", "--remotes"]) {
        Ok(out) => out,
        Err(_) => return Ok(HashSet::new()),
    };

    let set: HashSet<String> = output
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    Ok(set)
}

#[derive(Debug, Clone)]
pub struct RawCommit {
    pub sha: String,
    pub parents: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    pub author_time: i64,
    pub subject: String,
}

pub fn parse_log_output(raw: &str) -> Vec<RawCommit> {
    let mut list = Vec::new();

    for chunk in raw.split('\x1e') {
        let chunk = chunk.trim_matches('\n');
        if chunk.is_empty() {
            continue;
        }

        let fields: Vec<&str> = chunk.split('\0').collect();
        if fields.len() < 6 {
            continue;
        }

        let sha = fields[0].trim().to_string();
        let parents = fields[1]
            .split_whitespace()
            .map(|s| s.to_string())
            .collect();
        let author_name = fields[2].to_string();
        let author_email = fields[3].to_string();
        let author_time = fields[4].trim().parse::<i64>().unwrap_or(0);
        let subject = fields[5].to_string();

        list.push(RawCommit {
            sha,
            parents,
            author_name,
            author_email,
            author_time,
            subject,
        });
    }

    list
}

/// Loads a paged list of commits with continuous lane graph.
pub fn log_with_state(
    exec: &dyn Exec,
    repo: &Path,
    filter: &LogFilter,
    skip: usize,
    limit: usize,
    state: Option<GraphState>,
) -> Result<(LogPage, GraphState), GitError> {
    let text_is_hex = filter
        .text
        .as_ref()
        .map(|t| t.len() >= 4 && t.chars().all(|c| c.is_ascii_hexdigit()))
        .unwrap_or(false);

    // If text search is a hex prefix >= 4 chars, match prefix sha via rev-parse --disambiguate
    let candidate_shas = if text_is_hex {
        let prefix = filter.text.as_deref().unwrap();
        let disambig_out = git(
            exec,
            repo,
            &["rev-parse", &format!("--disambiguate={}", prefix)],
        )
        .unwrap_or_default();
        let shas: Vec<String> = disambig_out
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect();
        if shas.is_empty() {
            return Ok((
                LogPage {
                    commits: Vec::new(),
                    graph: Vec::new(),
                    next_cursor: None,
                },
                state.unwrap_or_default(),
            ));
        }
        Some(shas)
    } else {
        None
    };

    // Calculate initial graph state for pagination continuity if not provided
    let initial_state = if let Some(s) = state {
        s
    } else if skip > 0 && candidate_shas.is_none() {
        // Replay preceding `skip` commits to recover active lanes
        let mut replay_args = vec!["log", "--author-date-order", "--format=%H%x00%P%x1e"];

        let skip_str = skip.to_string();
        replay_args.push("-n");
        replay_args.push(&skip_str);

        if filter.branches.is_empty() {
            replay_args.push("--all");
        } else {
            for b in &filter.branches {
                replay_args.push(b.as_str());
            }
        }

        let author_arg = filter.author.as_ref().map(|a| format!("--author={}", a));
        if let Some(ref a) = author_arg {
            replay_args.push(a.as_str());
        }
        let since_arg = filter.since.as_ref().map(|s| format!("--since={}", s));
        if let Some(ref s) = since_arg {
            replay_args.push(s.as_str());
        }
        let until_arg = filter.until.as_ref().map(|u| format!("--until={}", u));
        if let Some(ref u) = until_arg {
            replay_args.push(u.as_str());
        }

        let grep_arg = if let Some(ref text) = filter.text {
            if !text.is_empty() {
                Some(format!("--grep={}", text))
            } else {
                None
            }
        } else {
            None
        };
        if let Some(ref g) = grep_arg {
            replay_args.push(g.as_str());
            replay_args.push("-i");
        }

        if let Some(ref path) = filter.path {
            replay_args.push("--");
            replay_args.push(path.as_str());
        }

        let replay_out = git(exec, repo, &replay_args)?;
        let mut replay_commits = Vec::new();
        for chunk in replay_out.split('\x1e') {
            let chunk = chunk.trim_matches('\n');
            if chunk.is_empty() {
                continue;
            }
            let fields: Vec<&str> = chunk.split('\0').collect();
            if fields.len() >= 2 {
                let sha = fields[0].trim().to_string();
                let parents: Vec<String> = fields[1]
                    .split_whitespace()
                    .map(|s| s.to_string())
                    .collect();
                replay_commits.push((sha, parents));
            }
        }
        let (_, recovered_state) = layout(&replay_commits, GraphState::default());
        recovered_state
    } else {
        GraphState::default()
    };

    // Gather refs and pushed status
    let refs_map = get_refs_map(exec, repo)?;
    let pushed_shas = get_pushed_shas(exec, repo)?;

    // Build main git log command
    let mut args = vec![
        "log",
        "--author-date-order",
        "--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%s%x1e",
    ];

    let skip_str = skip.to_string();
    let limit_str = limit.to_string();

    if let Some(ref shas) = candidate_shas {
        args.push("--no-walk");
        for sha in shas {
            args.push(sha.as_str());
        }
    } else {
        if filter.branches.is_empty() {
            args.push("--all");
        } else {
            for b in &filter.branches {
                args.push(b.as_str());
            }
        }

        if skip > 0 {
            args.push("--skip");
            args.push(&skip_str);
        }
        if limit > 0 {
            args.push("-n");
            args.push(&limit_str);
        }
    }

    let author_arg = filter.author.as_ref().map(|a| format!("--author={}", a));
    if let Some(ref a) = author_arg {
        args.push(a.as_str());
    }
    let since_arg = filter.since.as_ref().map(|s| format!("--since={}", s));
    if let Some(ref s) = since_arg {
        args.push(s.as_str());
    }
    let until_arg = filter.until.as_ref().map(|u| format!("--until={}", u));
    if let Some(ref u) = until_arg {
        args.push(u.as_str());
    }

    let grep_arg = if !text_is_hex {
        filter.text.as_ref().and_then(|t| {
            if !t.is_empty() {
                Some(format!("--grep={}", t))
            } else {
                None
            }
        })
    } else {
        None
    };
    if let Some(ref g) = grep_arg {
        args.push(g.as_str());
        args.push("-i");
    }

    if let Some(ref path) = filter.path {
        args.push("--");
        args.push(path.as_str());
    }

    let raw_out = git(exec, repo, &args)?;
    let raw_commits = parse_log_output(&raw_out);

    let mut commits = Vec::with_capacity(raw_commits.len());
    let mut commit_tuples = Vec::with_capacity(raw_commits.len());

    for rc in raw_commits {
        let short_sha = rc.sha[..rc.sha.len().min(7)].to_string();
        let refs = refs_map.get(&rc.sha).cloned().unwrap_or_default();
        let pushed = pushed_shas.contains(&rc.sha);

        commit_tuples.push((rc.sha.clone(), rc.parents.clone()));
        commits.push(Commit {
            sha: rc.sha,
            short_sha,
            parents: rc.parents,
            author_name: rc.author_name,
            author_email: rc.author_email,
            author_time: rc.author_time,
            subject: rc.subject,
            refs,
            pushed,
        });
    }

    let (graph, final_state) = layout(&commit_tuples, initial_state);

    let next_cursor = if candidate_shas.is_some() || limit == 0 {
        None
    } else if commits.len() == limit {
        Some(skip + limit)
    } else {
        None
    };

    Ok((
        LogPage {
            commits,
            graph,
            next_cursor,
        },
        final_state,
    ))
}

pub fn log(
    exec: &dyn Exec,
    repo: &Path,
    filter: &LogFilter,
    skip: usize,
    limit: usize,
) -> Result<LogPage, GitError> {
    log_with_state(exec, repo, filter, skip, limit, None).map(|(page, _)| page)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_tracking() {
        assert_eq!(parse_tracking("[ahead 2]"), (2, 0));
        assert_eq!(parse_tracking("[behind 5]"), (0, 5));
        assert_eq!(parse_tracking("[ahead 3, behind 4]"), (3, 4));
        assert_eq!(parse_tracking("[gone]"), (0, 0));
        assert_eq!(parse_tracking(""), (0, 0));
    }

    #[test]
    fn test_parse_branches_output() {
        let raw = "\
refs/heads/main|*|main|sha_main||origin/main|[ahead 1]\n\
refs/heads/feature| |feature|sha_feat||origin/feature|[ahead 2, behind 3]\n\
refs/remotes/origin/main| |origin/main|sha_remote|||\n\
refs/remotes/origin/HEAD| |origin/HEAD|sha_remote|||\n\
refs/tags/v1.0.0| |v1.0.0|sha_tag_obj|sha_commit||\n\
refs/tags/v2.0.0| |v2.0.0|sha_commit2|||\n";

        let bl = parse_branches_output(raw);
        assert_eq!(bl.local.len(), 2);
        assert_eq!(bl.local[0].name, "main");
        assert!(bl.local[0].is_current);
        assert_eq!(bl.local[0].ahead, 1);
        assert_eq!(bl.local[0].behind, 0);

        assert_eq!(bl.local[1].name, "feature");
        assert!(!bl.local[1].is_current);
        assert_eq!(bl.local[1].ahead, 2);
        assert_eq!(bl.local[1].behind, 3);

        // Remote HEAD ignored
        assert_eq!(bl.remote.len(), 1);
        assert_eq!(bl.remote[0].name, "origin/main");

        // Tags
        assert_eq!(bl.tags.len(), 2);
        assert_eq!(bl.tags[0].name, "v1.0.0");
        assert_eq!(bl.tags[0].sha, "sha_commit"); // peeled tag
        assert_eq!(bl.tags[1].name, "v2.0.0");
        assert_eq!(bl.tags[1].sha, "sha_commit2");
    }

    #[test]
    fn test_parse_log_output_unicode_and_root() {
        let raw = "c100\0\0Alice 🚀\0alice@example.com\01700000000\0initial commit with 🚀 emoji and newline\ninside\x1e\n\
c200\0c100\0Bob\0bob@test.local\01700000050\0feat: second commit\x1e";

        let commits = parse_log_output(raw);
        assert_eq!(commits.len(), 2);

        assert_eq!(commits[0].sha, "c100");
        assert!(commits[0].parents.is_empty()); // root commit
        assert_eq!(commits[0].author_name, "Alice 🚀");
        assert_eq!(
            commits[0].subject,
            "initial commit with 🚀 emoji and newline\ninside"
        );
        assert_eq!(commits[0].author_time, 1700000000);

        assert_eq!(commits[1].sha, "c200");
        assert_eq!(commits[1].parents, vec!["c100"]);
        assert_eq!(commits[1].author_name, "Bob");
        assert_eq!(commits[1].subject, "feat: second commit");
    }
}
