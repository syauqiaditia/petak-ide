use crate::git::model::{Edge, EdgeKind, GraphRow, GraphState};

/// Pure layout algorithm for git log lane graphs.
///
/// Each commit takes an active lane waiting for it (leftmost), or the first free slot.
/// Duplicate lanes waiting for the same commit merge into that commit's lane (`MergeIn`).
/// The first parent continues on the commit's lane (`Straight`).
/// Subsequent parents take existing waiting lanes or new lanes (`BranchOut`).
/// Root commits end their lane.
pub fn layout<S1: AsRef<str>, S2: AsRef<str>>(
    commits: &[(S1, Vec<S2>)],
    mut state: GraphState,
) -> (Vec<GraphRow>, GraphState) {
    let mut rows = Vec::with_capacity(commits.len());

    for (sha_ref, parents_ref) in commits {
        let sha = sha_ref.as_ref();
        let parents: Vec<&str> = parents_ref.iter().map(|p| p.as_ref()).collect();

        // 1. Find all active lanes waiting for this commit SHA
        let matching_lanes: Vec<usize> = state
            .active_lanes
            .iter()
            .enumerate()
            .filter_map(|(idx, slot)| {
                if let Some(target) = slot {
                    if target == sha {
                        Some(idx)
                    } else {
                        None
                    }
                } else {
                    None
                }
            })
            .collect();

        let commit_lane = if let Some(&first) = matching_lanes.first() {
            first as u16
        } else {
            // No lane was waiting for this SHA. Pick first empty slot or append.
            if let Some((empty_idx, _)) = state
                .active_lanes
                .iter()
                .enumerate()
                .find(|(_, slot)| slot.is_none())
            {
                empty_idx as u16
            } else {
                let new_lane = state.active_lanes.len() as u16;
                state.active_lanes.push(None);
                new_lane
            }
        };

        let mut edges = Vec::new();

        // 2. Any duplicate lanes that were waiting for this commit merge into commit_lane
        for &dup_lane in matching_lanes.iter().skip(1) {
            edges.push(Edge {
                from: dup_lane as u16,
                to: commit_lane,
                kind: EdgeKind::MergeIn,
                color: dup_lane as u16,
            });
            state.active_lanes[dup_lane] = None;
        }

        // 3. Pass-through lanes: active lanes entering this row that are not commit_lane
        // and did not merge into commit_lane
        for (idx, slot) in state.active_lanes.iter().enumerate() {
            if idx != commit_lane as usize && !matching_lanes.contains(&idx) && slot.is_some() {
                edges.push(Edge {
                    from: idx as u16,
                    to: idx as u16,
                    kind: EdgeKind::Straight,
                    color: idx as u16,
                });
            }
        }

        // 4. Update active_lanes for parents of this commit
        if parents.is_empty() {
            // Root commit: this lane ends
            state.active_lanes[commit_lane as usize] = None;
        } else {
            // First parent continues in commit_lane
            let p0 = parents[0];
            state.active_lanes[commit_lane as usize] = Some(p0.to_string());
            edges.push(Edge {
                from: commit_lane,
                to: commit_lane,
                kind: EdgeKind::Straight,
                color: commit_lane,
            });

            // Subsequent parents (merge commits)
            for &p_other in &parents[1..] {
                // Check if any other lane is already waiting for p_other
                let existing_lane =
                    state
                        .active_lanes
                        .iter()
                        .enumerate()
                        .find_map(|(idx, slot)| {
                            if let Some(target) = slot {
                                if target == p_other && idx != commit_lane as usize {
                                    Some(idx)
                                } else {
                                    None
                                }
                            } else {
                                None
                            }
                        });

                let target_lane = if let Some(lane) = existing_lane {
                    lane as u16
                } else {
                    // Pick first empty slot or append
                    if let Some((empty_idx, _)) = state
                        .active_lanes
                        .iter()
                        .enumerate()
                        .find(|(idx, slot)| slot.is_none() && *idx != commit_lane as usize)
                    {
                        state.active_lanes[empty_idx] = Some(p_other.to_string());
                        empty_idx as u16
                    } else {
                        let new_lane = state.active_lanes.len() as u16;
                        state.active_lanes.push(Some(p_other.to_string()));
                        new_lane
                    }
                };

                edges.push(Edge {
                    from: commit_lane,
                    to: target_lane,
                    kind: EdgeKind::BranchOut,
                    color: target_lane,
                });
            }
        }

        // Trim trailing None from active_lanes to keep it compact
        while state.active_lanes.last() == Some(&None) {
            state.active_lanes.pop();
        }

        // Sort edges by (from, to, kind) for determinism
        edges.sort_by_key(|e| (e.from, e.to, e.kind as u8));

        rows.push(GraphRow {
            lane: commit_lane,
            color: commit_lane,
            edges,
        });
    }

    (rows, state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_graph_linear() {
        // C3 -> C2 -> C1
        let commits = vec![("c3", vec!["c2"]), ("c2", vec!["c1"]), ("c1", vec![])];

        let (rows, state) = layout(&commits, GraphState::default());

        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].lane, 0);
        assert_eq!(rows[0].color, 0);
        assert_eq!(
            rows[0].edges,
            vec![Edge {
                from: 0,
                to: 0,
                kind: EdgeKind::Straight,
                color: 0,
            }]
        );

        assert_eq!(rows[1].lane, 0);
        assert_eq!(rows[1].color, 0);
        assert_eq!(
            rows[1].edges,
            vec![Edge {
                from: 0,
                to: 0,
                kind: EdgeKind::Straight,
                color: 0,
            }]
        );

        // Root commit has no outgoing edge
        assert_eq!(rows[2].lane, 0);
        assert_eq!(rows[2].color, 0);
        assert_eq!(rows[2].edges, vec![]);

        assert!(state.active_lanes.is_empty());
    }

    #[test]
    fn test_graph_branch_and_merge() {
        // M (parents: [C1, B1])
        // | \
        // C1 B1 (both have parent C0)
        // | /
        // C0 (parent: [Root])
        // |
        // Root (parents: [])
        let commits = vec![
            ("M", vec!["C1", "B1"]),
            ("C1", vec!["C0"]),
            ("B1", vec!["C0"]),
            ("C0", vec!["Root"]),
            ("Root", vec![]),
        ];

        let (rows, state) = layout(&commits, GraphState::default());
        assert_eq!(rows.len(), 5);

        // M: lane 0, branches out to lane 1 for B1
        assert_eq!(rows[0].lane, 0);
        assert_eq!(
            rows[0].edges,
            vec![
                Edge {
                    from: 0,
                    to: 0,
                    kind: EdgeKind::Straight,
                    color: 0,
                },
                Edge {
                    from: 0,
                    to: 1,
                    kind: EdgeKind::BranchOut,
                    color: 1,
                },
            ]
        );

        // C1: lane 0 straight, lane 1 pass-through
        assert_eq!(rows[1].lane, 0);
        assert_eq!(
            rows[1].edges,
            vec![
                Edge {
                    from: 0,
                    to: 0,
                    kind: EdgeKind::Straight,
                    color: 0,
                },
                Edge {
                    from: 1,
                    to: 1,
                    kind: EdgeKind::Straight,
                    color: 1,
                },
            ]
        );

        // B1: lane 1, lane 0 pass-through
        assert_eq!(rows[2].lane, 1);
        assert_eq!(
            rows[2].edges,
            vec![
                Edge {
                    from: 0,
                    to: 0,
                    kind: EdgeKind::Straight,
                    color: 0,
                },
                Edge {
                    from: 1,
                    to: 1,
                    kind: EdgeKind::Straight,
                    color: 1,
                },
            ]
        );

        // C0: lane 0, lane 1 merges into lane 0
        assert_eq!(rows[3].lane, 0);
        assert_eq!(
            rows[3].edges,
            vec![
                Edge {
                    from: 0,
                    to: 0,
                    kind: EdgeKind::Straight,
                    color: 0,
                },
                Edge {
                    from: 1,
                    to: 0,
                    kind: EdgeKind::MergeIn,
                    color: 1,
                },
            ]
        );

        // Root: lane 0, no outgoing edges
        assert_eq!(rows[4].lane, 0);
        assert_eq!(rows[4].edges, vec![]);
        assert!(state.active_lanes.is_empty());
    }

    #[test]
    fn test_graph_octopus_merge_3_parents() {
        let commits = vec![
            ("M", vec!["P0", "P1", "P2"]),
            ("P0", vec![]),
            ("P1", vec![]),
            ("P2", vec![]),
        ];

        let (rows, _) = layout(&commits, GraphState::default());

        assert_eq!(rows[0].lane, 0);
        assert_eq!(
            rows[0].edges,
            vec![
                Edge {
                    from: 0,
                    to: 0,
                    kind: EdgeKind::Straight,
                    color: 0,
                },
                Edge {
                    from: 0,
                    to: 1,
                    kind: EdgeKind::BranchOut,
                    color: 1,
                },
                Edge {
                    from: 0,
                    to: 2,
                    kind: EdgeKind::BranchOut,
                    color: 2,
                },
            ]
        );
    }

    #[test]
    fn test_graph_two_roots() {
        // Two independent root histories
        let commits = vec![
            ("A2", vec!["A1"]),
            ("A1", vec![]),
            ("B2", vec!["B1"]),
            ("B1", vec![]),
        ];

        let (rows, state) = layout(&commits, GraphState::default());
        assert_eq!(rows.len(), 4);

        assert_eq!(rows[0].lane, 0);
        assert_eq!(rows[1].lane, 0); // Root A1 ends lane 0
        assert_eq!(rows[2].lane, 0); // B2 takes available lane 0
        assert_eq!(rows[3].lane, 0); // Root B1 ends lane 0

        assert!(state.active_lanes.is_empty());
    }

    #[test]
    fn test_graph_paging_continuous() {
        // Test paging continuity across merge:
        // Results of 2 paged calls must exactly equal 1 single call
        let commits = vec![
            ("M", vec!["C1", "B1"]),
            ("C1", vec!["C0"]),
            ("B1", vec!["C0"]),
            ("C0", vec!["Root"]),
            ("Root", vec![]),
        ];

        let (rows_all, state_all) = layout(&commits, GraphState::default());

        // Split at various cutoffs (e.g. 1, 2, 3, 4)
        for split_at in 1..commits.len() {
            let (rows_p1, state_p1) = layout(&commits[..split_at], GraphState::default());
            let (rows_p2, state_p2) = layout(&commits[split_at..], state_p1);

            let mut combined = rows_p1;
            combined.extend(rows_p2);

            assert_eq!(
                combined, rows_all,
                "failed continuous layout with split_at={}",
                split_at
            );
            assert_eq!(
                state_p2, state_all,
                "failed state match with split_at={}",
                split_at
            );
        }
    }
}
