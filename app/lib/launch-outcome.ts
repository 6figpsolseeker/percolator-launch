/** E2E B21: never call a market "launched" while its required price feed is unregistered. */
export type LaunchPriceFeedStatus = "not-needed" | "registered" | "missing";

export function launchPriceFeedStatus(s: { priceFeedRequired: boolean; keeperDelegated: boolean }): LaunchPriceFeedStatus {
  if (!s.priceFeedRequired) return "not-needed";
  return s.keeperDelegated ? "registered" : "missing";
}
