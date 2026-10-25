# @baserate/sdk

TypeScript building blocks for Baserate on Mezo. ESM source, `viem` 2.57.11 as a peer dependency.

| Module      | Contents                                                                                                                                                                                                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chains`    | `mezoTestnet` (31611, `rpc.test.mezo.org`), `mezo` (31612, fallback RPCs + multicall3 from block 351,760), `mezoLocalFork` (31337), `transportFor`, `gasReserveWei`                                                                                                                                                       |
| `addresses` | Typed registry parsed from `src/deployments/<chainId>.json` (`getRegistry`, `isDeployed`, `computeMarketId`). External addresses mirror every address field of `contracts/script/config/MezoAddresses.sol`, zero where a network lacks one (a test enforces it). Baserate contracts (core, Backstop, FlashLiquidator, FeeRouter, RiskLens, vMUSD and its adapters and allocator) carry address, deploy tx and block; zero placeholders where not deployed |
| `abis`      | ABIs generated from `contracts/out` by `scripts/gen-abis.mjs` (BorrowAccountFactory, BorrowAccount, WsMUSD, BtcMusdOracle, CollateralBTC, MusdDispenser, Backstop, FlashLiquidator, FeeRouter, RiskLens, BaserateAllocator, WsMusdLiquidityAdapter, Morpho VaultV2), plus hand-written Morpho Blue, AdaptiveCurveIrm, ERC-20/permit, sMUSD, Skip, Pyth and trove-queue ABIs. Every Baserate ABI carries the full custom-error set |
| `math`      | Morpho `toAssetsUp`/`toSharesDown` (virtual shares 1e6, virtual assets 1), interest accrual, LTV, health factor, liquidation price, liquidation incentive `min(1.15, 1/(0.3·LLTV + 0.7))`, rate → APR/APY, `quoteBorrow`, nominal ICR, ERC-4626 conversions                                                               |
| `oracle`    | Policy constants and `computeOracleStatus`, a client-side mirror of `BtcMusdOracle.status()`                                                                                                                                                                                                                              |
| `periphery` | Venue and allocator-action enums, `minProfitFor`, `liquidationBtcUsd`, vMUSD cap ids (`vaultAdapterCapId`, `vaultCollateralCapId`, `vaultMarketCapId`), `vaultDepositRoom`, `vaultWithdrawRoute`, bribe epochs (`epochStart`, `nextEpochFlip`), RiskLens `SRC_*` flags (`riskSourceStates`) |
| `permit`    | MUSD EIP-2612: domain `{"Mezo USD", "1", chainId, MUSD}`, typed data, `signMusdPermit` (deadline from chain time), `splitPermitSignature`, `canSignPermit`, allowance-slot state overrides for pre-simulation                                                                                                             |
| `errors`    | `decodeBaserateError` / `decodeRevertData`: custom errors, OpenZeppelin errors, Morpho string reasons, wallet rejections and RPC failures as plain messages                                                                                                                                                               |
| `format`    | MUSD (2 dp), BTC (6–8 dp), USD, percentages, durations, `parseAmount`                                                                                                                                                                                                                                                     |
| `explorer`  | Blockscout UI and API URLs per chain                                                                                                                                                                                                                                                                                      |

```sh
pnpm --filter @baserate/sdk test       # vitest
pnpm --filter @baserate/sdk typecheck
```

Regenerate ABIs after contract changes with `cd contracts && forge build && cd ../packages/sdk && pnpm gen:abis`.
Deployments JSONs follow `contracts/deployments/<chainId>.json` and the forge broadcasts.
