# JH-902522 report

The full report is at
`docs/harness/reports/jh-902522-backlog-c1/report.md`, which is where the other
harness reports live. This file exists because the run brief also names this
path.

Summary: the server gains `findSnapshot`, a versioned, bounded, resumable read
of several board queries. On the local stack with the restored JH snapshot the
expensive full board read drops from 194 round trips to 7 (27.7x) and the
filtered cards read from 79 to 3 (26x). Wall clock improves 1.75x for the full
read and 7.2x for cards only, so no tenfold latency claim is made.

Test results: `docs/reports/jh-902522-backlog-c1/gate-results.jsonl`.
