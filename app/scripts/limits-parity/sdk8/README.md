# SDK 8.0.0 pricing vectors

`__tests__/fixtures/limits/sdk8-pricing-vectors.json` pins the app's Earn worse-of port
(`lib/limits/earn-pricing.ts`) to `@percolatorct/sdk` 8.0.0 (`52b7412`,
`src/solana/p3-vault-lp.ts`): `vaultLpEquityLagBoundsP3`, `boundVaultSeniorValueP3`,
`boundVaultDepositQuoteP3`, `vaultLpSeniorPricingClaimP3` on 400 seeded random cases each.

Regenerate (8.0.0 is not on npm yet, so the functions are taken verbatim from the SDK commit):

```sh
git -C ~/percolator-sdk show 52b7412:src/solana/p3-vault-lp.ts > /tmp/p3.ts
# copy the block from "/** One active vault-LP leg" up to "// Resolved exit planner" into
# sdk8-pricing.ts next to gen.ts, prefixed with POS_SCALE_P3 = 1_000_000n,
# LP_VAULT_MINIMUM_LIQUIDITY_P3 = 1_000n, sat, minB (the SDK's own definitions), then:
tsx gen.ts ../../../__tests__/fixtures/limits/sdk8-pricing-vectors.json
```

Once 8.0.0 is published, `earn-pricing.ts` switches to importing the SDK functions and this
fixture keeps holding.
