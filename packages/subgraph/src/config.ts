// Mezo testnet (chain 31611) constants the mappings compare against, lowercase hex. They must match
// packages/sdk/src/deployments/31611.json; `pnpm check-config` (run by `pnpm build`) verifies them.

/** Morpho market id of M1 (MUSD loan, bcBTC collateral). */
export const M1_MARKET_ID = '0xa8c1e3b34cb6f3b84f0b20e69af435f315330f47a06422fb7593e4422467bb74'

/** wsMUSD: BaserateAllocator's CheckpointRecorded observes its share price. */
export const WS_MUSD = '0xdafcb2cd3e722f6fee7f70150be612f1d7af8124'

/** vMUSD adapters, to label Allocate / Deallocate. */
export const WS_MUSD_ADAPTER = '0x9897b43c83b3dcc6f574b19ce39ef85abf1dfc29'
export const M1_ADAPTER = '0xd0e612460e35c646f7617a24abeb84a842beb61b'
