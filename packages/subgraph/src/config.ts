// Mezo testnet (chain 31611) constants the mappings compare against, lowercase hex. They must match
// packages/sdk/src/deployments/31611.json; `pnpm check-config` (run by `pnpm build`) verifies them.

/** Morpho market id of M1 (MUSD loan, bcBTC collateral). */
export const M1_MARKET_ID = '0xadd5f62435744e4fe91c94212024eba66fe93af38824bf264dee64258aebb13b'

/** wsMUSD: BaserateAllocator's CheckpointRecorded observes its share price. */
export const WS_MUSD = '0x92aa0306c3af1e02d776ea05857653a3839debeb'

/** vMUSD adapters, to label Allocate / Deallocate. */
export const WS_MUSD_ADAPTER = '0x75a44270a2ca424d3cf4a70bde4d018fc1adf24f'
export const M1_ADAPTER = '0xffbdbe74f1f118dde2c2fe09286f3aa9f448b394'
