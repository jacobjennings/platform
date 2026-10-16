Merge.

Reviewed commit: 3b57b510a0e2f836356410c05d1247263cffeb73
Applied-fix tip: 74c5c03f4

Task: http://huly.lan/workbench/hulyaccessevaluation/tracker/HP-1

The model change adds an Activity application when existing workspaces next receive a model upgrade. It changes no existing documents and adds no migration.

This is the narrow continuation of the earlier Node setup finding. The source checkout is Huly Platform and the target is jj/activity-feed. The brief's generic jake-harness repository description is incorrect. Since the earlier preview fix, the source tip changed only its report.

## Applied fix

harness.toml:44 now pins the existing /home/jakej/.local/opt/node-22/bin/node through the supported tests.node setting. The merge runner otherwise discards the inherited PATH and selects system Node 26. No product behavior changes. Node reported v22.23.3 before any install. No compatibility override or runtime installation is used.

## Validation

Selection: git diff --name-only origin/jj/activity-feed...HEAD and rg -n 'feed-query|components/feed' plugins models --glob '*test*'. The search finds feed-query.test.ts:39 importing ./feed-query. The Director explicitly requests the two package checks again to clear the Node setup failure.

The runner will install dependencies, validate only through @hcengineering/notification-resources, then run npx jest src/components/feed/feed-query.test.ts and npm run svelte-check from plugins/notification-resources. It also runs checks/home-access-test.py from the pinned harness with isolated HOME and fresh XDG folders. Results and tested merge hash are pending the runner below. No test has run yet in this continuation. No full suite is selected.

## Could not check

- Rendered acceptance is not checked. Browsers are prohibited. The earlier report records no worker captures attached. No live board was read.
- The outcome helper writes board stages and messages, so it will not run under this brief's board-write prohibition. Merge ancestry will be checked through Git.

## Failing after merge

- none

## Hygiene notes

- none

## RECOMMENDATIONS

No follow-on is declared. Complete the prescribed targeted merge checks and record their actual results here.

NOT MERGED
