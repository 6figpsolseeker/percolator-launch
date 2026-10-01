# P3 sim: the vault-owned-LP journey executing APP-BUILT instructions

## ede691b6 (Earn exit/entry at the worse of effective vs pending target, 2026-09-30): current run

`limits_app_first_trade_one_signature_and_race` (UX WP-6): the app's tx A [CreateAccount,
InitPortfolio] and tx B [Deposit, TradeCpi] are built together BEFORE A lands (one signature), B bound
to the predicted id read from the market bytes (asset 0 AssetOracleProfileV16.next_portfolio_id,
rustc offset 480; `handle_init_portfolio` allocates from there, not WrapperConfigV16): predicted 2 ==
assigned 2, sequence 0 / epoch 0, and B opens the 0.1 position. Race: another wallet initialises in
between; B is refused Custom(16) EngineProvenanceMismatch, the app's classifier says race + deposit
leg, and B rebuilt with the real id lands. Passes on ede691b6 and 4b1a5d30.

New in `p3_senior_draw.limits-app.patch`: `limits_app_worse_of_77_payout_matches_preview`. The
app's Earn preview (bridge `earn-price` = `lib/limits/earn.ts earnPanelPricing` ->
`lib/limits/earn-pricing.ts earnSeniorPricing`, the one port of `vault_lp_equity_lag_bounds_ro` +
the 77 Live rule), from RAW bytes and the NAV the page passes (registry shares + fee distributions):
- control (no move): preview 4,999,000 == the app 77's payout 4,999,000 == the plain number;
- 3x target pushed, effective price lagging at 20 bps/slot (1.002 vs 3.0): the lag bounds are
  evaluated from real bytes (worse 14,193 < better 297,200); the crank re-stamps the bound vault
  LP's short (1.4 -> 0.14) so the move stays inside the junior, and the preview 5,000,000 equals the
  payout exactly. The binding branches (C_price below C; the LP at max(worse, 0) when nav < C) are
  pinned against rustc vectors / hand cases in `__tests__/lib/limits/earn-pricing.test.ts`.

Also on ede691b6: one catch-up crank now costs **20,846 CU** (17,010 on 4b1a5d30), so the app's
`CATCH_UP_CRANK_CU` is 25,000 (engine-stale threshold dt x 32); since 221cf006 a senior larger than
one pot redeems across both pots, so in `limits_app_redeem_repair_25_pot_mismatch_and_88` scen 1 the
plain app 77 lands (7,528,308 = fair) with no repair (4b1a5d30: 88 -> other-pot, same payout).
Results: `p3_senior_draw` limits_app 4/4 and `p3_vault_lp` limits_ 8/8 on `~/wt-p3-wrapper/out/p3-ede691b6.so`
(sha256 707383375fc6054c...); limits_app 4/4 on `p3-batched-4b1a5d30.so`.

## 39b138c8 (P3 FINAL: d119eebd senior draw + D-P3-30 recall cap, 2026-09-30): current run

Patches: `p3_vault_lp.limits-app.patch` (as below) and **`p3_senior_draw.limits-app.patch`** (new),
over `feat/p3-vault-owned-lp@39b138c8`. The new test is
`limits_app_senior_draw_absorbed_logs_and_88_recall_then_redeem`, APP-BUILT through `p3-app-ixs.ts`:
- the FIRST C-reading instruction is the app's Earn deposit (75, vault LP **writable**, both
  ledgers writable): it books the pending draw, and the app's log parser
  (`lib/limits/p3-draw-logs.ts`) reads `earnAbsorbed = 1,635,213` from its real logs;
- "Earn absorbed" from real bytes (`decodeVaultLpState` -> `earnAbsorbed`): outstanding = drawn = 1,635,213;
- after the junior re-funds, the app's next 75 logs `p3_senior_draw_restored`: `earnRestored = 1,635,213`, outstanding 0;
- B24 / 88: the senior's plain app 77 (vault LP writable) is refused **Custom(88)** (negative control);
  the app's repair (`recall-variants`: exactly the lists `sendTx`'s `planSeniorDrawRepair`
  simulates) lands on its first candidate, a 98 recall of 1,635,213 before the 77. The senior is paid
  8,998,824 = its exact pro-rata claim (C 10,002,000 x 8,999,000 / 10,002,195); conservation holds.

Results on BOTH builds: my `cargo build-sbf --features devnet` of 39b138c8 (`4320d9dc…`) and the
P3 lane's relaunch `~/wt-p3-wrapper/out/p3-senior-draw-39b138c8.so` (`e92e204b…`):
`p3_vault_lp` 50/50 (8/8 `limits_`), `p3_senior_draw` 13/13 (+1 upstream `#[ignore]`).
Run: `INDEP_WRAPPER_SO=<.so> LIMITS_APP_DIR=... TSX_BIN=... cargo test --release --test p3_senior_draw -- limits_app`.

gate-100 follow-up (still 39b138c8): `limits_app_redeem_repair_25_pot_mismatch_and_88`. Seniors split
1M d0 / 9M d1; a large redeem through the registry pot is refused **25** (ledger principal, before the
88 check) or 88. The app's repair variants (`redeemRepairVariants`: other pot, recall, other pot +
recall into it) each land and pay the exact pro-rata claim: draw outstanding, d1 senior: 25 ->
other-pot 7,528,308; restored, d0: 88 -> recall 998,980; restored, d1: 88 -> other-pot + recall
8,999,824; control d0 with the draw outstanding: no repair needed.


## 58e379f1 (P3 FINAL, 2026-09-30): current run

Patch now over `feat/p3-vault-owned-lp@58e379f1` (engine `35ddd692` unchanged). Added on top of
the tests below (all APP-BUILT through `p3-app-ixs.ts`):

| test | what it proves (real wrapper + matcher BPF, LiteSVM) |
|---|---|
| `limits_app_p3_single_asset_market_binds_and_trades` | the market is created by the APP's M1 (`init-market`: `createAccount(slab, slabSizeFor)` + InitMarket from `buildV17InitMarketArgs`), 1 slot, 3675 B = `market_account_len_for_capacity(1)`; the app bind (94 auto-pin + 96) lands and a trade follows; conservation holds |
| `limits_app_legacy_14_slot_market_is_refused_by_94_negative_control` | same, with the LEGACY args (14 slots, 33900 B): tag 94 refuses `VaultLpMultiAssetMarket` (86), no vault-LP state |
| `limits_app_p3_f14_terminal_order_101_78_77_102` | F-14 order: sweep `settle-vault-lp` (101 moves no SPL, asserted) -> close-empty -> close-resolved -> close-empty -> `harvest` (78) -> ready; both seniors' app 77 pay >= principal (5,033,600 / 10,066,193), C left = 1,007 (dead-share dust); the junior's app 102 Resolved (`junior-release`, `lib/limits/junior-resolved-release.ts`) pays exactly `physical - C` = 60,000,000; one atom more is refused 83; afterwards the app plans nothing; conservation holds |

Results, 8/8 `limits_` and 50/50 for the whole `p3_vault_lp` (with `P2_MATCHER_SO`), on BOTH builds:
- mine: `cargo build-sbf --features devnet` in this worktree, sha256 `731138c1b26a34ecb6cb002973d4a98983c01f79e363ca2bb1c74aa17aa51406`;
- RELAUNCH (P3 lane, `~/wt-p3-wrapper/percolator-prog`, src identical to 58e379f1): `f1a1dfc3ff7e86ffea53394295c8e587f3309e9bda6dd3d9ce6bfcc68e07b21e`, copied into `target/deploy/` for the run and restored.

App-side negative controls on real BPF: `P3_MARKET_ASSET_SLOTS = 14` -> the single-asset test fails
(app slot count 14); `juniorResolvedReleasableAtoms` returning `physical` (ignoring C) -> 102 refused
`Custom(83)`. Each restored byte-identical and green after.

The sections below are the earlier heads' record (kept as-is).

Patch over `dcccrypto/percolator-prog` `feat/p3-vault-owned-lp@07a1d0eb` — the FINAL combined head
(P1 `3acb34ae`; tag 94 marketauth-only with AUTO-PIN; 78 on terminal-flat Resolved; C-4(b)) — with engine `35ddd692` as the
sibling `../percolator` and the matcher `.so` from `percolator-match@12bd671` at
`../percolator-match/target/deploy/`. Earlier runs on `424fe7e4` and `ee29b5ac` gave identical
results up to the auto-pin change (the bind and the resolved harvest are the 07a1d0eb deltas). It appends to `tests/p3_vault_lp.rs`:

| test | what it proves (real wrapper + matcher BPF, LiteSVM) |
|---|---|
| `limits_app_p3_end_to_end` | (07a1d0eb) the wizard bind is `createAccount(LP) + createAccount(ctx, owner = canonical matcher) + 94 (11 accounts, auto-pin) + 96` and a trade lands IMMEDIATELY after it (no protocol 99/95); the vault-LP bytes are dumped for `__tests__/hooks/useTrade.vault-lp-autopin.test.ts`. Every app-sent instruction comes from `app/scripts/limits-parity/p3-app-ixs.ts`, i.e. the SAME lib code the hooks call: wizard M4p (`buildP3BindIxs`: createAccount + 94 path A + 96); bound Earn deposit (`earnTxPlan` + `buildEarnDepositIxs`, tail [11]/[12]); live redemption with the P3-K1 harvest (`buildEarnExecuteIxs`: 78 + 77, tail [13]/[14]); the whole resolved sweep planned from RAW account bytes (`planResolvedExit` + `exitStepIxs`: 101 -> 8(owner = registry) -> 30 permissionless -> 8 -> ready) and the resolved redemption. Negative controls in-test: the deposit with its tail stripped is refused; 77 without the prepended 78 fails `VaultLpHarvestPending` (84). Conservation (`assert_conserved`) holds. |
| `limits_app_p3_own_cleanup_before_reclaim` | E2E B12 app side: the trader's OWN portfolio on a Resolved market via the app's owner-signed group (`planOwnPortfolioCleanup`, bridge `own-cleanup`): 30 + 8 in ONE tx, `materialized_portfolio_count` 2 -> 1, payout 19,700,000 to the owner's ATA, conservation holds |
| `limits_app_p3_resolved_harvest_then_redeem` | fees unharvested at resolution: the APP's sweep ends `sweep:harvest` (78 once terminal-flat) and the APP's redemption pays 10,142,985 (= the harvest-while-live control) |
| `limits_ui_repro_resolved_redemption_with_pending_fees` | the program finding (FAILED on 424fe7e4 / ee29b5ac / b2b2559e: 77 `Custom(84)` forever, 78 `Custom(21)`); on 07a1d0eb it PASSES: 84 before the harvest, 78 before terminal-flat still 21, 78 after terminal-flat lands, then 77 pays |
| `limits_ui_repro_control_harvest_before_resolve_redeems` | control for the repro: same sequence with 78 run while Live => the redemption pays (10,142,985) |

Run against BOTH wrapper builds of each head, results identical every time:
- `07a1d0eb`: mine `f6eec5dd1a44d6c32bd0daed339f67386fb2b1e963ce51526326a1fb5f7d4ccd`; RELAUNCH `8410a5d7e85528bd8ac4a32c3ca5b0c6aa5c6a7ced3499855c252286005c71cc` (P3 lane), 5/5 pass on both;
- `b2b2559e`: this worktree's `cargo build-sbf --features devnet` (Solana 3.1.15) sha256 `d13498d9cab395b98053b47b65fd5128c978d7e27ad8bea63313395e98749a85`, and the RELAUNCH artifact (the P3 lane's `target/deploy`, reproduced 3x by that lane) sha256 `94e77a35116f66aeb26122ded9fe6d121ded6645cff5832b68c59606ac1273c0`, copied into `target/deploy/` for the run and then restored;
- `ee29b5ac` (superseded): `99fa011c…` (mine) and `608d3f8c…` (then-relaunch).
The bytes differ by build path (known: bytecode is path-dependent); behaviour does not.

App-side negative controls that re-run THIS scenario (scratch `negctl/run5.py`): deposit without the
bound tail -> `NotEnoughAccountKeys`; close-empty rent to the closer -> `Custom(8)`; 101 junior dest =
payer's ATA -> `Custom(11)`; each restored byte-identical and green after.

```bash
cargo build-sbf --features devnet
LIMITS_APP_DIR=<percolator-launch>/app TSX_BIN=<percolator-launch>/node_modules/.bin/tsx \
  cargo test --release --test p3_vault_lp -- limits_
```

### UX WP-8 (2026-09-30): "Finish now" on real BPF

| Test | What it proves |
|---|---|
| `limits_app_p3_finish_now_one_approval` | The APP builds the WHOLE "Finish now" list from ONE snapshot right after resolve (bridge `finish`, `lib/limits/resolved-finish.ts`): 17 items = vault-LP 101 copies + top-up, the open trader's CloseResolved copies + 46 claim, the flat trader, the close-empties, the 78 harvest and the Earn depositor's own 76 last, each tx at the APP's per-step compute budget. The driver re-plans before each item with the app's skip rule (bridge `finish-needed`, `stepNeeded`). 8 sent / 9 copies never sent, every sent item lands (the identities the pre-built ClosePortfolio binds stay valid through the closes), the market ends terminal-flat, and the depositor's app 77 then pays 10,085,391; conservation holds. Negative controls: broadcasting every copy (skip rule off) is refused `Custom(21)` at the first unneeded copy; the first ClosePortfolio budget (60k/80k) was refused (it consumes 122,469), which is why `EXIT_STEP_CU["close-empty"]` is 180k. `LIMITS_FINISH_MEASURE=1` prints each step's consumed CU. |

### Relaunch cutover (2026-10-01): wrapper 5544302a, matcher EDKK

Patches `*.limits-app-5544302a.patch` apply to a clean `git archive` of wrapper 5544302a (engine
35ddd692, matcher constant `EDKKgRaVHna6FCxiY1kgMzegD9rpaN1nwJNSzAzeBUBX`). All 12 `limits_` tests in
`p3_vault_lp` and 5/5 `limits_app` in `p3_senior_draw` pass at the APP's own per-step budgets.

| Test | What it proves |
|---|---|
| `limits_app_p3_resolved_77_after_vault_lp_win_needs_78_first` | 5544302a leaves stray pot backing at terminal-flat: the app's plain 77 is refused `Custom(84)`; the app's forced 78+77 (`sendWithHarvestOn84`) pays. |
| `limits_app_p3_partial_receipt_topup_after_101` | The app's "Finish now" (blocks A-G, pre-sign pruning via bridge `finish-prune`, skip rule) finishes three markets in ONE run: trader won, vault LP won, two traders (vault LP net won), each with and without the viewer's own early CloseResolved. Outcomes are identical either way (viewer, other trader, senior), nothing is refused at broadcast, conservation holds. Measured: 101 up to 425,253 CU and CloseResolved up to 301,288, over the old 320k / 240k budgets, which this run refused before `EXIT_STEP_CU` was raised. These scenarios do not dilute a receipt on 5544302a (an early winner's close is progress-only); the diluted case is the gate's fuzz repro (`p3_resolved_lock` eedb), so the 46 ordering is proven by the app model tests (`resolved-partial-receipt.test.ts`). |
| `limits_app_p3_vault_won_negative_control_without_101_retry` | The pre-fix ordering (traders held until the vault LP settled, no 101 retry) never finishes a market whose vault LP won: every 101 is progress-only and the senior's 77 never becomes payable. |

```bash
LIMITS_APP_DIR=<percolator-launch>/app TSX_BIN=<percolator-launch>/node_modules/.bin/tsx \
  cargo test --release --test p3_vault_lp -- limits_ --test-threads=1
```

### Empty-portfolio closes before 77 / 102 (2026-10-01)

| Test | What it proves |
|---|---|
| `limits_app_p3_empty_closes_prepended_before_77_and_102` | After an APP sweep that leaves every `close-empty` undone (bridge `exit` with `skip`), a senior's APP 77 alone is refused `Custom(21)`; the APP's tag-8 closes (bridge `empty-closes`, `readEmptyCloseIxs`) + 77 in ONE tx pay the senior whole (10,099,789); conservation holds. |
| `limits_app_p3_empty_closes_prepended_before_102` | The same staging for the junior: the APP's 102 alone is refused `Custom(21)`; closes + 102 in one tx release 60,000,000. |

All 14 `p3_vault_lp limits_` tests pass on 5544302a with these.
