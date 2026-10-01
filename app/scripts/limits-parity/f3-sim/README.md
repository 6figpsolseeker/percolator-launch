# F-3 sim: the #519 LiteSVM scenario executing APP-BUILT exits

Patch over `dcccrypto/percolator-prog` `fix/f3-market-freeze@dec380a0` (draft PR #519), with the engine at `35ddd692` as the sibling `../percolator`.

It adds `f3_app_built_owner_exits_reopen_market_after_single_bankruptcy` to `tests/indep_conservation_fuzz.rs`. For every holder, the test spawns `app/scripts/limits-parity/f3-app-ixs.ts`, which calls the app's `buildRebalanceCloseIxs`. It then executes those exact instructions, `[PermissionlessCrank(own portfolio), RebalanceReduce(|position|)]`, in one owner-signed transaction.

```bash
LIMITS_APP_DIR=<percolator-launch>/app TSX_BIN=<percolator-launch>/node_modules/.bin/tsx \
INDEP_WRAPPER_SO=<deployed v18.2 wrapper .so, sha256 4472b383…> \
INDEP_MATCHER_SO=<percolator-match 12bd671 .so> \
cargo test --release --test indep_conservation_fuzz -- f3_app_built_owner_exits
```

## E2E B10 (round 4): the other side after one side fully exited

Also in the patch (same env as above; bridge `app/scripts/limits-parity/f3-app-b10.ts`, which emits
the app's plain exit and its `adlExitCandidates`, applied with the app's `chooseAdlExit` rule):

| test | result on the deployed v18.2 wrapper |
|---|---|
| `b10_trace_second_side_tag44_without_repair` | after u0 (long) exits by tag 44, the shorts' app tx `[crank, 44]` fails at ix 3 (the 44) with **Custom(18)**: the crank already settled their ADL'd leg to zero, and the revert undoes it. The crank alone leaves them flat |
| `b10_app_exits_after_one_side_drained` | NO keeper/harness repair between exits: `u0: tag44`, `u2: crank-settles`, `u4: crank-settles+finalize`; every holder exits, A = ADL_ONE, both side modes Normal (the app's last exit sent FinalizeResetSide), `probe_recovered()` = the market reopens |
| `b10_app_exits_with_crank_only_keeper` | same with a keeper that cranks everyone but never finalizes: same routes, market reopens |
| `b10_control_plain_exit_alone_traps_the_other_side` | NEGATIVE CONTROL: the round-3 plain route only => u2/u4 stuck on Custom(18) for 3 passes |

The live E2E saw Custom(22) (EngineNonProgress) with the keeper running; the `finalize+tag44`
candidate covers that shape (selection pinned in `__tests__/lib/limits/adl-exit-plan.test.ts`); the
harness reproduced the 18 shape only.
