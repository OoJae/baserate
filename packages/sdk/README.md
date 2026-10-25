# @baserate/sdk

TypeScript building blocks for Baserate on Mezo. ESM source, `viem` 2.57.11 as a peer dependency.

| Module      | Contents                                                                                                                                                                                                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chains`    | `mezoTestnet` (31611, `rpc.test.mezo.org`), `mezo` (31612, fallback RPCs + multicall3 from block 351,760), `mezoLocalFork` (31337), `transportFor`, `gasReserveWei`                                                                                                                                                       |
| `addresses` | Typed registry parsed from `src/deployments/<chainId>.json` (`getRegistry`, `isDeployed`, `computeMarketId`). External addresses mirror `contracts/script/config/MezoAddresses.sol` (a test enforces it); Baserate contracts are zero-address placeholders until deployment                                               |
| `abis`      | Hand-written `as const` ABIs matching the shared interface: BorrowAccountFactory, BorrowAccount, WsMUSD, BtcMusdOracle (with `Status`), CollateralBTC, MusdDispenser, plus Morpho Blue, AdaptiveCurveIrm, ERC-20/permit, sMUSD, Skip, Pyth and the MUSD trove queue. Every Baserate ABI carries the full custom-error set |
| `math`      | Morpho `toAssetsUp`/`toSharesDown` (virtual shares 1e6, virtual assets 1), interest accrual, LTV, health factor, liquidation price, liquidation incentive `min(1.15, 1/(0.3·LLTV + 0.7))`, rate → APR/APY, `quoteBorrow`, nominal ICR, ERC-4626 conversions                                                               |
| `oracle`    | Policy constants and `computeOracleStatus`, a client-side mirror of `BtcMusdOracle.status()`                                                                                                                                                                                                                              |
| `permit`    | MUSD EIP-2612: domain `{"Mezo USD", "1", chainId, MUSD}`, typed data, `signMusdPermit` (deadline from chain time), `splitPermitSignature`, `canSignPermit`, allowance-slot state overrides for pre-simulation                                                                                                             |
| `errors`    | `decodeBaserateError` / `decodeRevertData`: custom errors, OpenZeppelin errors, Morpho string reasons, wallet rejections and RPC failures as plain messages                                                                                                                                                               |
| `format`    | MUSD (2 dp), BTC (6–8 dp), USD, percentages, durations, `parseAmount`                                                                                                                                                                                                                                                     |
| `explorer`  | Blockscout UI and API URLs per chain                                                                                                                                                                                                                                                                                      |

```sh
pnpm --filter @baserate/sdk test       # vitest
pnpm --filter @baserate/sdk typecheck
```

When the contracts track exports compiled ABIs and deployments, replace `src/abis.ts` with `@wagmi/cli` output and
regenerate `src/deployments/*.json` from the forge broadcast.
