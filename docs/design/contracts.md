# Baserate: smart contracts, tests and deployment plan

## 0. Corrections to the spec

1. **wsMUSD should not call `PCV.distributeMUSD()`.**
   - Verified source (MUSDSavingsRate, solc 0.8.33): `deposit()` and `withdraw()` already call `pcv.distributeMUSD()` in try/catch, but only `if (address(pcv) != 0)`. `claimYield()` never calls it.
   - Testnet `pcv()` = 0. A wsMUSD call to `address(0)` would revert, because the extcodesize check is not caught by try/catch.
   - The keeper calls `PCV.distributeMUSD()` itself before `wsMUSD.sync()`.
2. **A testnet yield demo through sMUSD donations is diluted.** Testnet sMUSD supply is 886,092 and `yieldIndex` is 163e18. A `receiveProtocolYield` donation spreads over all of it, so wsMUSD gets only its pro-rata share. For visible demo yield, send MUSD to wsMUSD itself: `sync()` absorbs the surplus as vesting yield. Label it as the yield simulator.
3. **Precompiles are not absent on a fork; they hang.** Skip, BTC and MEZO each have stub EVM bytecode that calls its own address (the Go node intercepts this on the live chain).
   - Under local revm fork execution, the stub recurses and reverts (verified with `cast call --trace`: Skip reverts, Morpho works).
   - Fork tests must `vm.etch` mocks.
   - On the live chain, `code.length > 0` holds for the BTC precompile, so Morpho's `NO_CODE` check passes.
4. **Skip semantics, from mezod `precompile/priceoracle/rounds.go`:**
   - `updatedAt` = `startedAt` = the block time of the last x/oracle price update, not "now".
   - `roundId` = oracle nonce; `answeredInRound` = 0; 18 decimals; BTC/USD only.
   - The precompile itself reverts on a nil or non-positive price.
   - The 60 s staleness check is meaningful.
5. **Precompile limit measured at exactly 20.** An eth_call loop over Skip reads succeeded at N = 20 and reverted at N = 21 on both networks. Reads count.
6. **The mint pause must not block `addCollateral`.** Blocking it would prevent users rescuing positions. Pausing stops new borrowing (including `openAndBorrow`/`openCanary`) and credit draws; collateral-only deposits and all exits stay open. For the same reason the position cap never applies to top-ups: it only stops new borrowing on a position above it.
7. **wsMUSD vesting must be previewable.** `totalAssets()` must equal the post-`sync()` value, otherwise ERC-4626 previews over-promise. Rules:
   - Unclaimed sMUSD yield counts 0. A sync claims it and it vests over 3 days with no instant part. (An earlier instant part, h × min(now − lastHarvest, 3d) / 3d, over-promised whenever `claimYield` reverted or paid short, and let same-block protocol yield move the price: audit B-3 and I-1.)
   - A same-block sandwich therefore gets 0, and nothing that lands in a block moves the price in it.
   - Donations and surplus vest the same way.
8. **Vault V2 relative caps.** The default `relativeCap` is 0, which blocks every allocation. Each id needs `increaseRelativeCap(idData, 1e18)` as well as an absolute cap > 0. `enter()` allocates to the liquidity adapter without try/catch (confirmed in the deployed source).
9. **Pinned versions:**
   - Mezo's VaultV2 matches vault-v2 tag `2026-07-08`/`2026-08-13` (comment-only diff).
   - MorphoMarketV1AdapterV2 is identical to tag `2026-08-13`; its constructor is `(parentVault, morpho, adaptiveCurveIrm)`.
   - Mezo's Morpho is the morpho-blue code under its GPL header. Tag v1.0.0 carries a BUSL header, so pin `main@9cf6d5b`.
10. **CREATE2 deployer gotcha.** Under the Arachnid CREATE2 deployer `0x4e59…956C` (present on both networks), constructors see `msg.sender` = the deployer contract. Pass governor, admin and seeder explicitly; never use `msg.sender` as admin.
11. **Restrict canary creation.** Use one factory with two profiles (STANDARD, CANARY) instead of a separate CanaryFactory, and restrict CANARY creation to `canaryOperator`. Open canaries at LLTV − 0.25 pt would let anyone plant bad-debt seeds in a market lenders fund. Granting the role is a 48 h timelocked raise; a revoked operator's CANARY account cannot borrow and withdraws against the STANDARD ceiling.
12. **Fee recipient must be settable.** The FeeRouter only exists in Wave 2, so `feeRecipient` is changeable through a 48 h timelock. The fee rate stays a constant 10 bps.
13. **Oracle discount disclosure.** The MUSD-leg clamp to [1.00, 1.02] undervalues collateral by about 1.1% at today's 0.989. Borrowers are liquidated slightly earlier than at the true BTC/MUSD price. This is conservative, but disclose it.
14. **Deploy-gas limit.** The block gas limit is 10M on both networks. Each deploy transaction (the factory with embedded brBTC and implementation) must stay under about 8M. Use `--gas-estimate-multiplier 110`.
15. **[I] Ticker clash.** "brBTC" is also Bedrock's BTC token ticker. This is low priority; a symbol like "bsBTC" would avoid confusion.
16. **The come-back flow can use the user's own clone directly.** CollSurplusPool pays with `_recipient.call{value}` (verified). BTC can land on the not-yet-deployed CREATE2 clone address. The clone needs `receive()`.

## 1. Verified this session (primary sources)

| Item | Result | How |
|---|---|---|
| EVM opcodes | PUSH0, TSTORE/TLOAD, MCOPY and CLZ all work on both networks | eth_call of raw init code |
| Morpho testnet `0xCe1d…5a73` | Verified `Morpho` (solc 0.8.19, paris). Owner `0x6e80…b017`. IRM `0x0c97…7441` enabled. LLTV 0.77 only (0.86, 0.915, 0.945, 0.625 off). feeRecipient 0 | Blockscout and cast |
| Morpho mainnet `0x5658…A311` | Owner `0x98D8…7C7a`. IRM `0x3760…c1e7` enabled. LLTV 0.86 only. One market `0x6f88…33db` | cast and getLogs |
| IRMs | Both verified `AdaptiveCurveIrm`, with `MORPHO()` = their own network's Morpho | Blockscout and cast |
| Market id | keccak256(abi.encode(loan, coll, oracle, irm, lltv)). Recomputed the testnet market `0x1a7f8d…0b2e` exactly | cast keccak |
| Morpho semantics | `_isHealthy` returns true when borrowShares == 0 (no oracle call). `withdrawCollateral` only accrues interest (IRM). `liquidate` calls the oracle, sends collateral, then `onMorphoLiquidate`, then pulls the loan token. Incentive = min(1.15, 1/(1 − 0.3(1 − lltv))): 4.38% at 0.86, 7.41% at 0.77. `safeTransfer` requires code | Verified source |
| sMUSD | Testnet impl `0x92D1…D98C`; mainnet impl `0xB33C…9e87`; identical source. Details below | Source diff and cast |
| MUSD | OZ v5 ERC20Permit, ECDSA-only. Domain {"Mezo USD", "1", chainId, token}, EIP-5267, separators recomputed exactly. Transfers to the token itself or to zero revert | Source and cast |
| Skip `0x7b7c…0015` | 18 decimals. Live price 80,661 (testnet) / 80,688 (mainnet). Historical reads work (`--block N`) | cast and mezod source |
| Pyth | Mainnet `0x5D28…7167` and testnet `0x933a…1315` are EIP-1967 `PythUpgradable`. BTC `0xe62d…5b43` and MUSD `0x0617…c6de` are fresh (86–332 s), expo −8. `getPriceUnsafe(bytes32)` returns (int64, uint64, int32, uint256) | cast |
| Precompile limit | 20 per transaction | eth_call probe |
| Vault V2 | Factory mainnet `0xA64f…40A6`, testnet `0x25eB…b239` (solc 0.8.28, cancun, via-IR, 100k runs). Template below | Blockscout and cast |
| Tigris (Wave 2) | CL200: token0 = BTC precompile, token1 = MUSD, tickSpacing 200. CLSwapRouter `ExactInputSingleParams{tokenIn, tokenOut, int24 tickSpacing, recipient, deadline, amountIn, amountOutMinimum, sqrtPriceLimitX96}` | Source and cast |
| Gauges (Wave 2) | CL200 gauge `0x21d7…209E` → bribe `0x80cC…0e1a` (alive). vAMM gauge `0x8Be2…9AaF` → bribe `0x94A9…E305`. MUSD whitelisted. `BribeVotingReward.notifyRewardAmount(token, amount)` | cast and source |
| Come-back (Wave 2) | BOS mainnet impl `0xa60A…26A9`. `claimCollateralWithSignature(borrower, recipient, sig, deadline)`, typehash `ClaimCollateral(address borrower,address recipient,uint256 nonce,uint256 deadline)`. Recipient may not be ActivePool or CollSurplusPool. CollSurplusPool pays with `call{value}` | Source |
| Infrastructure | Arachnid CREATE2, Multicall3, Permit2 and Safe 1.4.1 (singletons, factory, MultiSend) on both networks. CreateX absent. MezoForwarder is ECDSA-only | cast and source |
| Gas and block time | Testnet gas price 146 wei; mainnet 1.46e6 wei; 10M block gas limit; block ≈ 3.63 s; archive state ≥ 500k blocks back on both RPCs | cast |
| Verification | Blockscout Etherscan-style API `https://api.explorer(.test).mezo.org/api` works. Sourcify supports 31611 and 31612 | curl |
| Testnet MUSD source | Pool `0xd16A…6AA9` (token0 MUSD, token1 BTC, volatile) quotes 0.001 BTC → 78.65 MUSD. Router `0x9a1f…D7E9` uses `Route{from, to, stable, factory}`, factory `0x4947…Ce1A` | cast and source |

**sMUSD detail:**
- `deposit(uint256)`, `withdraw(uint256)` (auto-claims yield) and `claimYield()` (returns the amount) are all `nonReentrant`.
- `claimableYield(address)`, `supplyYieldIndex(address)`, `yieldIndex()`, `pendingYield()`; anyone can call `receiveProtocolYield(uint256)`.
- Errors: `ZeroAmount`, `InsufficientBalance`, and `AmountTooSmall` when amount × 1e18 / supply = 0. The minimum donation is 7,382,556 wei on mainnet and 886,093 wei on testnet.
- `_beforeTokenTransfer` updates yield for both `from` and `to`.
- Testnet: pcv = 0, vaultGauge = 0, strategy `0x6abE…47E0`, not forwarder-trusted.
- Mainnet: pcv `0x391E…B993`, VaultGauge cap 10k, IdleStrategy `0x0C09…a295`, `isTrustedForwarder(MezoForwarder)` = true.

**Vault V2 template (Mezo's USDC Lending Vault):**
- owner = curator = `0x98D8…`; maxRate = 15854895991 (50%/yr); fees 0; adapterRegistry 0; all timelocks 0.
- The liquidity adapter is MorphoMarketV1AdapterV2, with liquidityData = abi.encode(MarketParams).
- Adapter ids: `keccak(abi.encode("this", adapter))`, `keccak(abi.encode("collateralToken", coll))`, `keccak(abi.encode("this/marketParams", adapter, params))`.

## 2. Foundry project

**Layout** (`/Users/oluwademilade/Desktop/mezo/contracts`; app and keeper are siblings):
```
foundry.toml  remappings.txt  .env.example  justfile
src/
  interfaces/ IBorrowAccount.sol IBorrowAccountFactory.sol IBrBTC.sol IWsMUSD.sol
  interfaces/external/ IMUSDSavingsRate.sol IPythLite.sol IAggregatorV3.sol IBorrowerOperationsSignatures.sol
      (W2: ICLSwapRouter.sol IRouter.sol IPoolsVoter.sol IBribeVotingReward.sol IQuoterV2.sol ICLPool.sol)
  oracle/BtcMusdOracle.sol   savings/WsMUSD.sol   collateral/BrBTC.sol
  account/BorrowAccount.sol  account/BorrowAccountFactory.sol
  (W2) vault/WsMusdLiquidityAdapter.sol vault/BaserateAllocator.sol liquidation/FlashLiquidator.sol
       liquidation/Backstop.sol fees/FeeRouter.sol lens/RiskLens.sol credit/CreditLineModule.sol
test/
  unit/ fuzz/ invariant/(handlers/) fork/mainnet/ fork/testnet/ fork/blocks.json
  utils/ SkipMock.sol BtcPrecompileMock.sol(W2) SMUSDMock.sol MUSDMock.sol MorphoImports.sol MezoFork.sol Addr.sol
script/
  config/Networks.sol  01_DeployOracle 02_DeployWsMUSD 03_DeployCore 04_SeedMarket 05_DemoBorrow 06_ExportRegistry
  live/ LiveOracleProbe LiveOpenBorrow LiveRepayExit   (W2: 10..16, below)
deployments/31611.json 31612.json   abi/
```

**Dependencies** (`forge install` at these refs):

| Dependency | Ref | License | Use |
|---|---|---|---|
| foundry-rs/forge-std | v1.17.0 (`f3dae6e`) | Apache-2.0/MIT | Tests and scripts |
| OpenZeppelin/openzeppelin-contracts | v5.7.0 (`cab1993`) | MIT | ERC20, ERC4626 (with `_transferIn`/`_transferOut` hooks), ReentrancyGuardTransient, SafeERC20, Clones (`cloneDeterministicWithImmutableArgs`, `fetchCloneArgs`), EIP712, SignatureChecker (W2), Math. All files are ^0.8.20–^0.8.24, fine with 0.8.28 |
| morpho-org/morpho-blue | main `9cf6d5b844625ba108e36d1cf911f5d2faf7c136` | GPL-2.0-or-later | IMorpho, IOracle, callbacks, MarketParamsLib, SharesMathLib, MathLib, periphery MorphoBalancesLib; Morpho.sol (0.8.19) for local tests |
| morpho-org/morpho-blue-irm | v1.1.0 (`ef5dcce`) | MIT (check file headers) | AdaptiveCurveIrm for local tests (0.8.19) |
| morpho-org/vault-v2 (W2) | tag `2026-08-13` (`2b139002feaf4631f1c63d880380ca2278df7aec`) | GPL-2.0 | IVaultV2, IAdapter, MorphoMarketV1AdapterV2, MorphoVaultV1Adapter (liquidity-adapter template) |

- Solady and the Pyth SDK are not needed; write a 10-line `IPythLite`.
- thUSD `B.Protocol/BAMM.sol` (MIT) is a reference for the Backstop pricing only, with credit in the NatSpec header.
- Project license: `src/` is GPL-2.0-or-later because it imports Morpho and vault-v2 GPL libraries.

**Compiler:**
- Our code uses `pragma solidity 0.8.28;` with `evm_version = "cancun"`. This is the subset verified on Mezo, and the exact compiler and EVM of Mezo's Vault V2. Use the transient reentrancy guard.
- Do not pin `solc` globally. Auto-detect compiles morpho-blue at 0.8.19 and vault-v2 at 0.8.28.

**foundry.toml:**
```toml
[profile.default]
src="src"; test="test"; script="script"; libs=["lib"]
evm_version="cancun"; optimizer=true; optimizer_runs=10_000; via_ir=false
bytecode_hash="ipfs"; cbor_metadata=true          # Sourcify full match
fs_permissions=[{access="read-write",path="./deployments"},{access="read",path="./test/fork"}]
[profile.default.fuzz]      runs=512
[profile.default.invariant] runs=128  depth=64  fail_on_revert=false
# W2: compile vault-v2 sources with via-IR (format as used in vault-v2's own foundry.toml)
[[profile.default.compilation_restrictions]]
paths="lib/vault-v2/src/**"
via_ir=true
[profile.fork-mainnet]  match_path="test/fork/mainnet/*"
[profile.fork-testnet]  match_path="test/fork/testnet/*"
[profile.ci]  fuzz={runs=2048}  invariant={runs=256,depth=100}  no_match_path="test/fork/*"
[rpc_endpoints]
mezo_mainnet="${MEZO_MAINNET_RPC}"   # https://mezo-mainnet.boar.network (do not use rpc.mezo.org)
mezo_testnet="${MEZO_TESTNET_RPC}"   # https://rpc.test.mezo.org
[etherscan]
mezo_testnet={key="blockscout",url="https://api.explorer.test.mezo.org/api",chain=31611}
mezo_mainnet={key="blockscout",url="https://api.explorer.mezo.org/api",chain=31612}
```
- CI runs fork suites in a separate job, at pinned blocks with the RPC cache.
- Remappings: `@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/`, `morpho-blue/=lib/morpho-blue/src/`, `morpho-blue-irm/=lib/morpho-blue-irm/src/`, `vault-v2/=lib/vault-v2/src/`, `forge-std/=lib/forge-std/src/`. After installing vault-v2, check its nested `lib/` remappings with `forge remappings`.
- Keys: use a `cast wallet import` keystore and pass `--account`. No raw keys in `.env`.

## 3. Wave 1 contracts (full detail)

Global rules:
- No proxies, ERC-2771, `tx.origin` or EIP-1271 in our contracts.
- Every state-changing external function uses the transient `nonReentrant` guard.
- Custom errors throughout.

### 3.1 BtcMusdOracle (immutable, Morpho `IOracle`)
- **Storage:** none.
- **Immutables:**
  - `PYTH`;
  - `BTC_FEED = 0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43`;
  - `MUSD_FEED = 0x0617a9b725011a126a2b9fd53563f4236501f32cf76d877644b943394606c6de`.
- **Constants:**
  - `SKIP = 0x7b7c000000000000000000000000000000000015` (same on both networks);
  - `SKIP_MAX_AGE = 60`, `PYTH_BTC_BAND_MAX_AGE = 600` (the band), `PYTH_MAX_AGE = 3900` (the MUSD leg), `MAX_DEV_BPS = 1000`;
  - `MUSD_MIN = 1e18`, `MUSD_MAX = 1.02e18`.
- **Functions:**
  - `price() view returns (uint256)` = `btcUsd18 * 1e36 / musdUsd18`. Check: 0.001 BTC gives 80.66 MUSD of value, i.e. 62.1 MUSD of maximum borrow at 0.77.
  - `btcUsd() view returns (uint256 px18, uint256 updatedAt)`, validated: `answer > 0`, `now − updatedAt ≤ 60`; `updatedAt > now` is treated as age 0.
  - `musdUsd() view returns (uint256 px18, bool fresh)`: clamped to [1.00, 1.02] while Pyth MUSD is at most 3,900 s old; 1.00 if stale or invalid.
  - `pythBtc() view returns (uint256 px18, bool fresh)`: `fresh` while Pyth BTC is valid and at most 600 s old.
  - `status() view returns (Status)`: never reverts (try/catch on Skip). Fields: Skip answer and age, Pyth BTC and MUSD with ages, deviation in bps, `ok`, `reason`. Used by the UI, RiskLens and the keeper.
- **Pyth reads:** low-level `staticcall` to `getPriceUnsafe`. Require 128-byte return data, `price > 0`, `expo ∈ [−18, 0]`. Otherwise treat as stale; never revert on Pyth. Scale with `uint64(price) * 10**(18 + expo)`.
- **Band:** if Pyth BTC is fresh (at most `PYTH_BTC_BAND_MAX_AGE` = 600 s old) and |skip − pyth| × 1e4 > 1000 × pyth, revert `PythDeviation(skip, pyth)`. Pyth is pushed about hourly, so the band is on for the first 10 minutes after a push. A stalled or lagging Pyth therefore stops gating within 10 minutes and cannot freeze liquidations through a fast crash for longer (round-2 audit R2X-2; the bound used to be 3,900 s).
- **Errors:** `SkipInvalidAnswer(int256)`, `SkipStale(uint256 age)`, `PythDeviation(uint256, uint256)`.
- **Precompile cost:** 1 Skip call per `price()`.

### 3.2 WsMUSD (immutable ERC-4626 over sMUSD; asset MUSD; 18 decimals; offset 0)
- **Immutables:** `SMUSD`, `CAP_ADMIN` (the governor Safe, passed explicitly).
- **Constants:** `VESTING = 3 days`, `MIN_HARVEST = 1e15`, `CAP_TIMELOCK = 72 hours`.
- **Storage:** `depositCap`, `pendingCap`, `pendingCapAt`, `_stored`, `_unvested`, `uint64 _lastSync`, `uint64 _periodEnd`, `uint64 _lastHarvest` (informational: the last sync whose claim did not revert).
- **Functions** (each ERC-4626 entry point runs `nonReentrant`, then `_sync()`, then OZ logic):
  - `deposit`, `mint`, `withdraw`, `redeem`;
  - `depositWithPermit(assets, receiver, deadline, v, r, s)`: permit in try/catch, then proceed if the allowance suffices;
  - `sync() returns (uint256 harvested)`, permissionless;
  - `redeemInKind(shares, receiver, owner) returns (uint256 smusdOut, uint256 musdOut)`: realizes vesting only and makes no sMUSD deposit, withdraw or claim calls. Pays `previewRedeem(shares)` in sMUSD 1:1, plus MUSD for any shortfall;
  - `pendingYield() view` = `claimableYield(this) + balanceOf(this) * (yieldIndex − supplyYieldIndex(this)) / 1e18`, exactly sMUSD's `_updateYieldFor`;
  - `vestingState() view`;
  - `submitCapRaise(uint256 newCap)` (`CAP_ADMIN`, newCap > cap), `acceptCapRaise()` (anyone after 72 h), `revokeCapRaise()` (`CAP_ADMIN`). There is no lowering and no pause.
- **`totalAssets()`** = `_stored + vested`, with vested = `_unvested × (min(now, periodEnd) − lastSync) / (periodEnd − lastSync)`. Unclaimed sMUSD yield counts 0.
- **`_sync()` mutations:**
  1. Move vested into `_stored`.
  2. If `pendingYield ≥ MIN_HARVEST`: `try SMUSD.claimYield()`. `lastHarvest` advances unless the claim reverts.
  3. Compute added = (sMUSD balance + MUSD balance) − (`_stored` + `_unvested`): the harvest plus any surplus (donations, withdraw auto-claims, PCV distributions). Absorb it into `_unvested` if ≥ `MIN_HARVEST`. Whatever the claim did, `totalAssets()` is unchanged in this block.
  4. Re-deposit idle MUSD ≥ `MIN_HARVEST` with `try SMUSD.deposit`.
  5. Set `periodEnd = now + VESTING` only when a new amount was added.
  6. Set `lastSync = now`.
- **`_transferIn`:** `transferFrom`, then `forceApprove(SMUSD)`, then `SMUSD.deposit(assets)`, then `_stored += assets`.
- **`_transferOut`:** pay from idle MUSD first. Otherwise `SMUSD.withdraw(assets − idle)` (skip zero amounts; any auto-claimed extra becomes surplus), then `_stored −= assets`.
- `maxDeposit` = `cap − totalAssets` (floored at 0). `maxMint` follows from it.
- **Seed:** the deploy script deposits 1 MUSD to `0x…dEaD` in the same broadcast. The inflation attack is already moot, because internal accounting means donations never move the price instantly.
- **Events:** `Synced(harvested, instant, surplus, stored, unvested, periodEnd)` (`instant` is always 0, kept for ABI compatibility), `RedeemedInKind`, `CapRaiseSubmitted`, `CapRaised`, `CapRaiseRevoked`.
- **External calls:**
  - sMUSD (testnet `0x6f46…8e16`, mainnet `0xb4D4…51CC`): `deposit`, `withdraw`, `claimYield`, `claimableYield`, `yieldIndex`, `supplyYieldIndex`, `balanceOf`, `transfer`;
  - MUSD (testnet `0x1189…c503`, mainnet `0xdD46…F186`): `transferFrom`, `approve`, `permit`.
- **Precompile cost:** 0.

### 3.3 BrBTC (immutable gated receipt; OZ ERC20 "Baserate BTC", 18 decimals)
- **Immutables:** `FACTORY = msg.sender` (deployed inside the factory constructor), `MORPHO`.
- **Storage:** ERC20 only.
- **Functions:**
  - `wrap() payable returns (uint256)`: requires `IBorrowAccountFactory(FACTORY).isAccount(msg.sender)` and `msg.value > 0`, then mints `msg.value` to `msg.sender`.
  - `unwrap(uint256 amount, address to)`: `nonReentrant`; any holder; `_burn` first, then `to.call{value: amount}("")`.
  - No `receive` or fallback.
- **`_update(from, to, v)` gate:**
  - mint: only inside `wrap`;
  - burn: only inside `unwrap`;
  - `from == MORPHO`: allowed (covers `withdrawCollateral` and `liquidate`);
  - `to == MORPHO && isAccount(from)`: allowed (covers `supplyCollateral` pulling from the clone);
  - everything else: revert `TransferRestricted(from, to)`.
- **Consequences:**
  - A Morpho `flashLoan` of brBTC always reverts, because the return leg is not from an account.
  - Liquidators can only unwrap.
  - All M1 collateral entered through clones, so clone limits are market-wide. Morpho borrow `onBehalf` needs authorization, which clones never grant.
- **BTC balance rule:** native BTC and the BTC precompile share one balance, so accounting is `totalSupply` only.
  - Invariant: `address(this).balance ≥ totalSupply`. Precompile transfers can create unrecoverable surplus.
  - brBTC never calls the precompile and never approves on it, so nobody can pull its balance.
- **Events:** `Wrapped(account, amount)`, `Unwrapped(from, to, amount)`.
- **Errors:** `NotAccount`, `TransferRestricted`, `NativeSendFailed`, `ZeroAmount`.

### 3.4 BorrowAccount (EIP-1167 clone implementation) and BorrowAccountFactory

**Clone:**
- Created with `Clones.cloneDeterministicWithImmutableArgs(IMPL, abi.encodePacked(owner), salt = keccak256(abi.encode(owner, profile)), msg.value)`.
- `owner()` reads `fetchCloneArgs(address(this))`.
- No initializer, so nothing can be front-run.

**BorrowAccount immutables** (set in the implementation constructor; clones read them through delegatecall):
- `FACTORY = msg.sender`, `MORPHO`, `MUSD`, `BRBTC`, `ORACLE`;
- the five `MarketParams` fields, plus `MARKET_ID`;
- `LLTV`.

**BorrowAccount storage:**
- `mapping(address => bool) moduleEnabled`: the Wave 2 credit-line hook.

**Access:** `onlyOwnerOrFactory`. The factory only ever acts on `accountOf(msg.sender)`.

| Function | Behaviour |
|---|---|
| `openAndBorrow(uint256 musdOut, uint256 maxLtvBps, address receiver) payable` | If value > 0: `wrap{value}`, `approve(MORPHO)`, `supplyCollateral(P, v, this, "")`. If musdOut > 0, run the borrow path |
| borrow path (internal) | `require(!borrowPaused)`; receiver ≠ 0 and ≠ the clone (`InvalidReceiver`). fee = ceil(musdOut × 10 / 1e4) if feeRecipient ≠ 0. `MORPHO.borrow(P, musdOut + fee, 0, this, this)`, then transfer musdOut to receiver and fee to feeRecipient. Checks below |
| `borrow(musdOut, maxLtvBps, receiver)` | Borrow path only |
| `addCollateral() payable` | Wrap and supply. Not pausable, never capped |
| `supplyIdle(musdOut, maxLtvBps, receiver)` | Wraps the clone's own native balance (come-back path), supplies it, borrows optionally. Without a borrow it supplies everything; with a borrow only the room under the position cap, leaving the rest idle and rescuable |
| `repay(uint256 assets)` | Pulls MUSD from the owner. If assets ≥ debt, repays by shares. 0 precompile calls |
| `repayAndWithdraw(address btcTo)` and `repayAndWithdrawWithPermit(maxRepay, deadline, v, r, s, btcTo)` | `MORPHO.accrueInterest(P)`; debt = `borrowShares.toAssetsUp(tBA, tBS)` (SharesMathLib); pull exactly the debt from the owner; `repay(P, 0, shares, this, "")`; `withdrawCollateral(P, coll, this, this)`; `brBTC.unwrap(coll, btcTo)`. **No oracle call**, so it works while Skip is down |
| `withdrawCollateral(uint256 amt, address btcTo)` | If debt > 0, applies the LTV ceiling check (for a CANARY account whose owner lost the operator role, the lower of the CANARY and STANDARD ceilings, via `riskParams`). `btcTo` ≠ the clone |
| `borrowByModule(uint256 musdOut, uint256 maxLtvBps, address receiver)` | Wave 2 hook. Requires `moduleEnabled[msg.sender] && factory.isApprovedModule(msg.sender) && !creditPaused && !borrowPaused`. Same checks |
| `setModule(address, bool)` | `onlyOwner`. Enabling requires factory approval |
| `rescueNative(address to)` | `onlyOwner`. Sends idle native BTC |
| `sweep(address token, address to) returns (uint256)` | `onlyOwner`. Sends the clone's whole balance of `token` (MUSD sent to it directly, for example). bcBTC cannot leave this way: its gate only allows clone → Morpho |
| `receive() payable` | Accepts BTC from brBTC unwraps and CollSurplusPool |

**Borrow-path checks** (two Skip calls in total, ours plus Morpho's):
- `debt × 1e4 ≤ (coll × ORACLE.price() / 1e36) × min(maxLtvBps, ceilingBps[profile])`;
- position collateral ≤ `positionCap[profile]` (checked on the borrow path only; supplies are never capped);
- after the borrow, `market.totalBorrowAssets ≤ globalBorrowCap`;
- the clone ends every call with 0 MUSD and 0 brBTC (no receiver may be the clone itself).

**BorrowAccount events:** `Opened`, `Borrowed(owner, musdOut, fee, debt, ltvBps)`, `Repaid`, `Exited(repaid, btcOut)`, `CollateralAdded`, `CollateralWithdrawn`, `ModuleSet`, `NativeRescued`, `Swept`.

**BorrowAccount errors:** `Unauthorized`, `LtvTooHigh(uint256 ltvBps, uint256 limitBps)`, `PositionCapExceeded`, `GlobalCapExceeded`, `BorrowPaused`, `ModuleNotApproved`, `InvalidReceiver`.

**Exact Morpho ABI used:**
- `supplyCollateral(MarketParams, uint256, address, bytes)`;
- `borrow(MarketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) → (uint256, uint256)`;
- `repay(MarketParams, uint256, uint256, address, bytes) → (uint256, uint256)`;
- `withdrawCollateral(MarketParams, uint256, address onBehalf, address receiver)`;
- `accrueInterest(MarketParams)`;
- `position(Id) → (uint256 supplyShares, uint128 borrowShares, uint128 collateral)`;
- `market(Id) → (uint128 tSA, uint128 tSS, uint128 tBA, uint128 tBS, uint128 lastUpdate, uint128 fee)`.

**BorrowAccountFactory:**
- **Constructor:** `(morpho, musd, oracle, irm, lltv, bos, governor, sentinel, feeRecipient, globalCap, limits[2])`.
  - Deploys `BRBTC = new BrBTC(morpho)` and `IMPLEMENTATION = new BorrowAccount(...)`.
  - Does not create the market; the script does.
- **Immutables:** the above, plus `MARKET_ID`.
- **Constants:** `ORIGINATION_FEE_BPS = 10`, `TIMELOCK = 48 hours`, `EXECUTION_WINDOW = 14 days`, `MAX_CEILING_BPS = lltvBps − 25`.
- **Storage:**
  - roles: `governor`, `pendingGovernor`, `sentinel`;
  - risk: `globalBorrowCap`, `limits[Profile]{uint128 positionCap; uint16 ceilingBps}`, `borrowPaused`, `creditPaused`;
  - `feeRecipient`;
  - registries: `isApprovedModule`, `isCanaryOperator`, `isAccount`, `profileOf`;
  - the timelock queue (Vault V2-style, keyed by exact calldata): entries are stored under the current epoch of the parameter they change (the selector, plus the first argument for `setLimits`, `setModuleApproval`, `setCanaryOperator` and `setFeeRecipient`), and every instant decrease bumps that epoch, so a cut invalidates all raises of the same parameter queued before it. `executableAt(bytes)` is 0 unless the entry is live.
- **User functions:**
  - `openAndBorrow(musdOut, maxLtvBps) payable returns (address account)`;
  - `openCanary(musdOut, maxLtvBps) payable`: `isCanaryOperator` only;
  - `createAccount(address owner) returns (address)`: permissionless, STANDARD profile;
  - `accountOf(owner, profile) view returns (address, bool deployed)`;
  - `riskParams(address account) view`: one call returning limits, cap, pause flags and fee recipient (for a CANARY account whose owner lost the operator role, the lower of the two ceilings);
  - `comeBack(bytes claimSig, uint256 deadline, uint256 musdOut, uint256 maxLtvBps) returns (address account, uint256 claimed)`. Calls `BOS.claimCollateralWithSignature(msg.sender, account, sig, deadline)`, measures the balance delta, deploys the clone if needed, then calls `supplyIdle`. It is in Wave 1 code and fork-tested in Wave 2; BOS may be 0, which disables it.
- **Governance functions:**
  - `submit(bytes)` (governor), `revoke(bytes)` (governor or sentinel); a queued call is executable from 48 h after submission until `EXECUTION_WINDOW` after that;
  - `setGlobalBorrowCap` and `setLimits`: decreases are instant (governor or sentinel) and invalidate queued raises of the same parameter (`PendingInvalidated`); increases execute after 48 h (anyone may call); the ceiling must stay ≤ `MAX_CEILING_BPS`;
  - `setFeeRecipient` (timelocked);
  - `setModuleApproval` (add timelocked; remove instant);
  - `setCanaryOperator` (add timelocked; remove instant, governor or sentinel);
  - `setPaused(borrow, credit)`: pausing by governor or sentinel; unpausing by governor only;
  - `setSentinel`, two-step governor transfer.

### 3.5 M1 market

```
MarketParams({loanToken: MUSD, collateralToken: brBTC, oracle: BtcMusdOracle, irm: IRM, lltv: LLTV})
```
- Testnet: IRM `0x0c97fe017628636649ff374ad499529f91167441`, LLTV `770000000000000000`.
- Mainnet: IRM `0x3760ebc636f912a4db9540fda4dec09c25c6c1e7`, LLTV `860000000000000000`.
- `id = keccak256(abi.encode(params))`. The script asserts it equals `MarketParamsLib.id(params)` and that `market(id).lastUpdate != 0`.

**Per-network limits:**

| | Testnet (Wave 1) | Mainnet proof mode (Wave 2) |
|---|---|---|
| STANDARD | positionCap 0.01 BTC, ceiling 6200 bps | positionCap 0.02 BTC, ceiling 7100 bps |
| CANARY | positionCap 0.002 BTC, ceiling 7675 bps | positionCap 0.002 BTC, ceiling 8575 bps |
| globalBorrowCap | 5,000 MUSD | 2,000 MUSD |
| wsMUSD cap | 250k | 250k |

**Judge flow:** 0.0009 BTC as `msg.value` borrows 40 MUSD (debt 40.04 including the fee). LTV is about 49.6%, and liquidation would need a 35% BTC drop.

## 4. Wave 2 contracts (specs plus items to verify)

### vMUSD (Vault V2)
Created with `VaultV2Factory.createVaultV2(owner, MUSD, salt)`. **Verify:** the exact signature and event, `MAX_MAX_RATE`, the maximum force-deallocate penalty, and that testnet factory `0x25eB…` matches mainnet bytecode.

Configuration transactions, in order (VaultV2 starts with all timelocks at 0, so the curator batches `submit(x); x` through `multicall`):
1. Owner (the deployer EOA): `setCurator(deployer)`, `setIsSentinel(SAFE, true)`, `setName`, `setSymbol("vMUSD")`.
2. Deploy `MorphoMarketV1AdapterV2(vault, MORPHO, IRM)` and `WsMusdLiquidityAdapter(vault, wsMUSD)`.
3. Curator multicall:
   - `addAdapter` ×2;
   - `setIsAllocator(BaserateAllocator | SAFE | deployer, true)`;
   - `increaseAbsoluteCap(idData, cap)` and `increaseRelativeCap(idData, 1e18)` for each id: `abi.encode("this", mm)`, `abi.encode("collateralToken", brBTC)`, `abi.encode("this/marketParams", mm, M1)` (each cap ≤ the M1 cap, 2k), and `abi.encode("this", ws)` (cap = the vMUSD deposit cap, 3k in proof mode, because every deposit allocates there);
   - `setForceDeallocatePenalty(mm, small)`, `(ws, 0)`. The ws adapter itself rejects `forceDeallocate` while it is the vault's liquidity adapter (round-2 audit R2X-4), so its 0 penalty only applies once withdrawals no longer reach it.
4. Allocator (deployer): `setLiquidityAdapterAndData(ws, "")`, `setMaxRate(15854895991)`.
5. Curator: `setIsAllocator(deployer, false)`. Then `increaseTimelock(sel, 48h)` for addAdapter, removeAdapter, setIsAllocator, the four gates, setAdapterRegistry, abdicate, both fees, both fee recipients, increaseAbsoluteCap, increaseRelativeCap and setForceDeallocatePenalty. `decreaseTimelock` is auto-locked. Optionally `abdicate` the gates.
6. Owner: `setCurator(SAFE)`, `setOwner(SAFE)`.
7. Seed: deposit 100 MUSD with shares sent to `0x…dEaD`.

Fees stay 0, as in the USDC vault.

### Other Wave 2 contracts

**WsMusdLiquidityAdapter** (from vault-v2 MorphoVaultV1Adapter @ `2026-08-13`):
- `ids = [keccak256(abi.encode("this", this))]`.
- `allocate` deposits `min(assets, wsMUSD.maxDeposit(this))` and leaves the rest idle in the adapter.
- `deallocate` uses idle first. It reverts `ForceDeallocateDisabled` when the vault calls it from `forceDeallocate` (Vault V2 passes the selector) while this adapter is the vault's liquidity adapter with empty data (round-2 audit R2X-4). Its penalty is 0 and every withdrawal reaches it anyway, so a force-deallocation could only park vMUSD's wsMUSD position idle and forfeit its share of wsMUSD's vesting yield. Withdrawals and allocator or sentinel `deallocate` calls are unaffected, and `forceDeallocate` works again as an in-kind exit of last resort once the vault's exit path no longer reaches this adapter.
- `realAssets` = `previewRedeem(shares)` + idle; change = new − old allocation.
- `availableLiquidity` = idle + `wsMUSD.maxWithdraw(this)`. It is optimistic: a view cannot see an sMUSD withdraw that reverts, so the allocator's exits do not rely on it.
- Rescue (audit B-2): the vault's curator calls `submitRescue()`; after `RESCUE_TIMELOCK` (72 h, revocable by the curator or a sentinel) the curator or a sentinel calls `rescue()`. It first tries `wsMUSD.redeem(all shares)` into idle MUSD with a guaranteed 3M-gas stipend; if that works nothing leaves the adapter. Only if it reverts do the wsMUSD shares go in kind to the vault's owner for manual unwinding (`redeemInKind` to sMUSD), and the adapter keeps later allocations idle. The vault books the shares' value as a loss until the owner returns it, so the sentinel should also cut the adapter's cap to 0.
- Reentrancy rules: follow vault-v2's adapter docs (commits from 2026-10-12 to 10-15).

**BaserateAllocator** (permissionless; holds the allocator role):
- `rebalance()` keeps M1 idle ≥ max(2k MUSD, 15% of M1 supply). Buffer top-ups ignore the cooldown and do not start it, but run at most once per block (`lastTopUpAt`). When M1 was touched earlier in the block, a top-up is sized on the larger of spot liquidity and the last checkpoint's (its external liquidity plus vMUSD's M1 position), so a borrow or withdrawal undone in the same transaction cannot trigger one (round-2 audit R2X-3).
- Moves the excess only when two views agree (audit B-1). The direction comes from 7-day trailing realized APYs: M1's supply-share price against wsMUSD's `convertToAssets(1e18)`, both in the hourly checkpoint ring buffer, over the same window. The size is bisected on the spot model, M1 supply APY = `IRM.borrowRateView × utilization × (1 − fee)`, so the post-move rate still beats (or trails) wsMUSD's.
- No rate-driven move when M1 was touched earlier in the block (Morpho `lastUpdate == now`): its totals may be a transient supply, repay or borrow. A free `Morpho.accrueInterest` therefore vetoes that block's move; this liveness cost is kept on purpose (round-2 audit R2V-4).
- `TO_LIQUIDITY` is sized on a conservative liquidity: vMUSD's M1 position plus the lowest external M1 liquidity (supply − borrow − vMUSD) of now and of the last day's checkpoints. A checkpoint taken in a block where M1 was already touched carries the previous external liquidity forward unchanged, so a transient high or low is never recorded (round-2 audit R2V-3).
- At most 1k MUSD per call, with a 1 h cooldown between rate-driven moves. During the cooldown a call parks idle vault MUSD and returns `NONE` (the pending rate-driven move waits); it reverts `CooldownActive` only when there is nothing to park. `readyAt()` returns now while a top-up is due or idle MUSD can be parked.
- Every `rebalance` ends by parking idle vault MUSD in the liquidity adapter, within its caps.
- `withdraw`/`redeem` for vMUSD holders: idle and wsMUSD first, only the shortfall from M1. If the wsMUSD leg reverts, retry M1-first, so the M1-backed share always exits without the force-deallocate penalty.

**FlashLiquidator:**
- `liquidate(borrower, seizedAssets, venue, minProfit)` calls `Morpho.liquidate(M1, b, seized, 0, data)`.
- `onMorphoLiquidate` (only Morpho, with a transient in-flight flag): `brBTC.unwrap`, then sell to one of:
  - `Backstop.buyCollateral{value}`;
  - CL200 via `exactInputSingle(tickSpacing 200)` after `BTC.approve(router)`;
  - the vAMM via `Router.swapExactTokensForTokens(…, [Route(BTC, MUSD, false, factory)])`.
- Requires `out ≥ btc × skip × (1 − MAX_IMPACT)`, approves Morpho, and pays profit to the caller. Needs `receive()`.
- Forwards to the caller only the native BTC its own liquidation left behind (balance change over the call, e.g. a router refund or a CL partial fill). If the caller cannot take native BTC, the liquidation still succeeds and the BTC stays for the permissionless `sweepNative(to)`, so donated BTC can never block a liquidation.
- Budget: about 8 precompile calls (Morpho's oracle call 1, our Skip read 1, BTC approve, transferFrom and two pool `balanceOf`).

**Backstop (bMUSD, ERC-4626; idle MUSD held in wsMUSD):**
- `buyCollateral(minOut) payable` pays `btc × skip × (1 − incentive/2)`.
- NAV marks BTC inventory at Skip × 0.95 and excludes unvested premium. Inventory below `DUST_INVENTORY` (1e13 wei, about 1 MUSD) counts as 0, so dust never puts the oracle on the exit path; sales must take all the inventory or leave at least that much.
- Deposits and mints are priced at book + unvested (gross), not at NAV: each deposit joins the book and the unvested premium pro rata, so a late depositor pays for the premium still vesting and shares the next loss pro rata.
- Deposits and mints are closed while the inventory is at least `DUST_INVENTORY` (they revert `HoldingInventory`; `maxDeposit` and `maxMint` return 0). Held BTC sits at the 0.95 mark, below what its sale clears at, so a deposit between a purchase and its sale would take the recovery the incumbents paid for (audit R2V-1). Deposits never read the oracle.
- DeployLiquidation must seed 1 MUSD of dead shares and reverts before deploying anything without it: deposits are priced at gross, which a donation raises at once, so the seed is what defeats the inflation attack (audit R2V-2).
- `requestRedeem(shares)` / `claimRedeem(id)` after 7 days pay at min(NAV at request, NAV at claim). When cash is short, a claim pays all the cash, burns the matching fraction of the shares and keeps the rest queued. During an oracle outage the owner may `claimRedeemWithoutOracle(id)`, which values the inventory at 0 for that claim only.
- Payments use idle MUSD first, then `wsMUSD.withdraw`. If that withdraw reverts (a broken sMUSD withdraw), a claim is paid in kind: the idle MUSD plus wsMUSD shares worth the rest, rounded down (`PaidInKind`; the receiver leaves through `wsMUSD.redeemInKind`). A purchase reverts `CashUnavailable` instead, so the liquidator picks a DEX. An in-kind payment also pauses parking for `PARK_PAUSE` (1 day), or until a withdraw succeeds, so sale proceeds and deposits stay idle; meanwhile `quoteBuy` counts only idle MUSD (audit R2V-7). A gas-capped call cannot force the in-kind path: a withdraw that runs out of gas leaves too little for the rest of the claim.
- Premium vests over 7 days; losses are recognised instantly.
- Inventory is sold through a Dutch auction (Skip × 1.00 decaying to × 0.95 over 6 h) and bounded keeper sales.
- The sentinel can pause deposits only.

**FeeRouter (immutable 40/40/20):**
- `distribute()` splits new fees (the balance minus recorded carries) and sends 40% to `sMUSD.receiveProtocolYield(x)`. Amounts below sMUSD's `AmountTooSmall` floor (`ceil(supply/1e18)`) are carried to the next call.
- sMUSD is never trusted to succeed. Its reads are low-level calls that need 32 bytes back, and the donation runs with a 1M-gas stipend (a real one costs about 63k). It counts only if exactly `x` was pulled. On failure the approval is revoked and `x` is carried, while the treasury and bribe shares are still paid. Once a failure streak spans two epoch flips (7 to 14 days), the sMUSD share and its carry go to the treasury; one successful donation ends the streak.
- 40% goes to `BribeVotingReward.notifyRewardAmount(MUSD, x)` on the CL200 and vAMM bribes when `PoolsVoter.isAlive(gauge)`; otherwise to sMUSD. A non-bool or empty `isAlive` answer counts as dead.
- In the last hour of an epoch (`timestamp % 7 days > 7 days − 1 h`, when the Voter only accepts whitelisted veNFTs), every live gauge's share is carried. A gauge whose bribe has `totalSupply() == 0` votes also has its share carried. A carry is added to the same gauge's next bribe and is never split again. If the gauge is killed in the meantime, the carry goes to sMUSD.
- 20% of new fees goes to the treasury.
- **Verify:** testnet gauge `0x72D8…Cd2c` and bribe `0x75b6…0ee1` (alive, MUSD whitelisted on PoolsVoter `0x263F…`).

**RiskLens (views):**
- `oracle.status`, M1 state, caps, backstop solvency. Free MUSD is the backstop's `availableCash()`, so MUSD reserved for queued exits is excluded, and BTC held is its `inventory()`, so donated BTC is excluded. Both fall back to raw balances for an address without those views.
- Depth: QuoterV2 `0x4e56…` on mainnet; `Router.getAmountsOut` on testnet, where QuoterV2 is absent. A Skip answer above the oracle's `MAX_SKIP_ANSWER` gives no reference price, and the snapshot does not revert.
- CL10 `observe` TWAP; `SortedTroves.getLast/getPrev` and `TroveManager.getCurrentICR`. A trove with ICR below MCR (110%) is skipped by redemptions. It is still listed, but its debt does not count towards later troves' `debtAhead`.

**CreditLineModule:**
- Terms: `{maxOutstanding, periodLimit, period, maxLtvBps, expiry, recipient}`.
- `approveCredit(account, spender, terms)` by the owner, or `approveCreditWithSig` (OZ SignatureChecker: ECDSA or EIP-1271).
- `revokeCredit` takes effect instantly.
- `draw(account, amount)` checks the terms, then calls `account.borrowByModule(amount, maxLtvBps, recipient)`.
- `repayCredit` reduces the outstanding amount.
- Hard limits: ≤250 MUSD outstanding per account, ≤50 MUSD/day per spender.
- Go-live: approve it in the factory (48 h, so **submit on Nov 2**); the owner then calls `setModule`.

**Come-back:** already present as `factory.comeBack`.
- **Verify:** the BOS EIP-712 `SIGNING_DOMAIN` name/version constants and `getNonce`.
- Fork test: `vm.store` a `CollSurplusPool.balances[testEOA]` entry and its `collateral`, `vm.deal` the pool, and sign with a test key.

## 5. brBTC flows and precompile budget

**Open:** EOA → `factory.openAndBorrow{value}` → clone (deployed if needed, with value forwarded) → `brBTC.wrap{value}` → `approve(MORPHO)` → `Morpho.supplyCollateral` (Morpho pulls clone → Morpho; gate passes) → `borrow`.

**Exit:** `withdrawCollateral` to the clone (out of Morpho; gate passes) → `unwrap` → native BTC to the owner.

**Liquidation:** Morpho → liquidator (gate passes) → liquidator unwraps.

| Flow | Skip calls | Other precompile calls | Total (limit 20) |
|---|---|---|---|
| open / borrow / partial withdraw with debt | 2 | 0 | 2 |
| addCollateral / repay / repayAndWithdraw / come-back without borrow | 0 | 0 | 0 |
| wsMUSD (any) | 0 | 0 | 0 |
| FlashLiquidator via CL200 (Wave 2) | 2 | about 4 BTC precompile calls | about 6–8 |

Native value transfers are EVM statedb operations, not precompile calls [I]. A live testnet script confirms this.

## 6. Security

**Invariants:**
1. wsMUSD: sMUSD balance + MUSD balance ≥ `totalAssets()`.
2. wsMUSD share price is non-decreasing.
3. wsMUSD previews equal executed amounts.
4. A donation in the same block, including sMUSD protocol yield, does not change wsMUSD `totalAssets`.
5. `brBTC.balance ≥ totalSupply`.
6. `brBTC.balanceOf(MORPHO)` = Σ M1 collateral.
7. Every M1 collateral holder `isAccount`.
8. Clones hold 0 MUSD and 0 brBTC after every call.
9. Post-action LTV ≤ ceiling.
10. After any borrow, `totalBorrowAssets` ≤ the global cap.
11. No borrow succeeds while position collateral > cap; collateral top-ups always succeed.
12. Non-owners cannot change a position.
13. With the oracle reverting, `repayAndWithdraw` still succeeds.
14. (W2) Credit outstanding ≤ allowance, and revoked spenders cannot draw.
15. (W2) Backstop share value changes only on realized PnL.
16. (W2) Allocator moves stay within caps, never pull M1 below the buffer, and never come from M1 state touched earlier in the block. At most one buffer top-up runs per block, idle vault MUSD is always parked, and the wsMUSD adapter never accepts a force-deallocation while it is the liquidity adapter.

**Fuzz targets:**
- oracle math: expo range, clamps, the deviation boundary;
- wsMUSD rounding across deposit/mint/withdraw/redeem/in-kind, and the vesting schedule;
- brBTC transfer matrix (from × to × isAccount);
- LTV boundary ±1 wei;
- fee rounding;
- exact full repay by shares after arbitrary `warp`.

**Oracle failure (Morpho semantics):**
- Frozen: borrow, withdraw with debt, and liquidation.
- Still open: supplyCollateral, repay, and withdraw after full repay.
- The UI shows the oracle-free exit. A divergence freeze lasts at most 10 min (the band only applies while Pyth BTC is at most 600 s old); a Skip outage is unbounded. Disclose both.

**Roles:**
- Governor = Safe 2-of-3, used for timelocked raises.
- Sentinel = Safe: pause new borrows and credit, cut caps (which also cancels raises of the same parameter queued earlier), remove modules and canary operators, revoke pending raises, and (Vault V2) deallocate or decrease caps. It can never block repay, top-ups, the full exit, unwrap, redeem, liquidation or the backstop queue; partial withdrawals stay open within the LTV ceiling.
- On testnet the governor may be the deployer EOA during Wave 1, labelled as such.
- Timelocks: 48 h for factory (including canary-operator grants), Vault V2 and module approvals; 72 h for wsMUSD cap raises. Decreases are instant.

**Reentrancy:**
- Transient guards on all entry points; CEI in `unwrap`.
- sMUSD is itself `nonReentrant`, so wsMUSD never calls sMUSD from inside an sMUSD callback (none exist).
- The strategy packet never touches sMUSD, vMUSD or wsMUSD.

**Donation and inflation defenses:**
- wsMUSD uses internal accounting plus vesting, plus a 1 MUSD dead seed.
- brBTC accounting uses supply only.
- vMUSD gets a 100 MUSD dead seed.
- The Backstop gets a mandatory 1 MUSD dead seed (its deposits are priced at gross, which a donation moves at once).

**Red-team fixes mapped to code:**

| Finding | Fix in code |
|---|---|
| Real limits | brBTC `_update` gate and `isAccount`; invariants 6, 7, 10, 11 |
| Caps sized to depth | factory caps, keeper cap script, sentinel cuts |
| vMUSD deposit DoS | wsMUSD has no pause and a raise-only 250k cap; the adapter deposits `min(maxDeposit)`; id caps follow vault semantics; `maxRate` set in configuration step 4 |
| Fees | performance fee 0 |
| Backstop economics | 7-day queue at min(NAV) with partial claims, vested premium (new deposits buy their share of it at full value), deposits closed while BTC is held, 0.95 mark, FlashLiquidator as the primary path |
| Signed claims | `comeBack` pays only the caller's own clone, with borrower = `msg.sender` |
| sMUSD upgrade risk | `redeemInKind` makes no sMUSD state calls; the allocator's exit retries M1-first when wsMUSD cannot pay; the adapter's timelocked rescue moves vMUSD's wsMUSD shares in kind to the vault owner only if wsMUSD's redeem fails; the Backstop pays exits in kind and pauses parking when wsMUSD's withdraw reverts; keeper watches `Upgraded` and `StrategyUpdated`, then the sentinel cuts caps |
| Oracle liveness | 60 s Skip bound, band only while Pyth BTC ≤ 600 s (so a divergence freeze lasts at most 10 min), invariant 13 |
| Yield sniping | the vesting rule in §0.7 |
| ERC-2771 | absent; MezoForwarder is ECDSA-only, so contracts cannot be spoofed |
| M2 and EscapeHatch | not built |

## 7. Tests

**Harness:**
- `SkipMock` (etched at `0x7b7c…0015`): `decimals() = 18`; `latestRoundData()` returns (nonce, answer, ts, ts, 0). Modes: LIVE (ts = `block.timestamp`), FIXED, REVERT. `setAnswer` is available.
  - `MezoFork.setUp` creates a fork at the block from `test/fork/blocks.json`, etches the mock, and seeds it with the real historical price via `vm.rpc("eth_call", [{to: SKIP, data: 0xfeaf968c}, blockHex])`.
- `BtcPrecompileMock` (W2, at `0x7b7C…0000`):
  - `balanceOf(a) = a.balance`;
  - `transfer` and `transferFrom` move balances via `vm.deal`; allowances live in mock storage.
  - Verify that cheatcodes can be called from a non-test contract. Fallback: route through a test-contract helper.
- Pyth: `vm.mockCall` on `getPriceUnsafe` for fresh, stale and divergent cases.
- Local stack: `deployCode("Morpho.sol:Morpho", abi.encode(owner))` plus AdaptiveCurveIrm (0.8.19 artifacts via `MorphoImports.sol`), `MUSDMock` (OZ ERC20Permit), and `SMUSDMock` replicating the MUSDSavingsRate index, auto-claim, nonReentrant and AmountTooSmall semantics.
- Fork MUSD comes from `deal(MUSD, …)` (OZ v5 balances live at slot 0).

**Mainnet fork (pinned near block 12.72M):**
- wsMUSD against real sMUSD (impl `0xB33C…`), including `receiveProtocolYield` yield, PCV-triggered distribution, the sandwich attempt and `redeemInKind`.
- The full Wave 1 stack with M1 at 0.86 on real Morpho and IRM: open, borrow, repay, exit, oracle-down exit, caps and pause.

**Testnet fork (pinned near block 16.33M):** the same at 0.77, with testnet sMUSD and pcv = 0.

**Live testnet scripts (real precompiles):**
- `LiveOracleProbe` checks `status()` and Skip age ≤ 60.
- `LiveOpenBorrow` records the transaction hash for the evidence page.
- `LiveRepayExit` uses a permit.

**Target counts:**

| | Wave 1 | Wave 2 (added) |
|---|---|---|
| Unit | about 40 | about 90 |
| Fuzz | about 10 | about 20 |
| Invariant suites (local: 128 runs × 64 depth; fork: 32 runs nightly) | 2 suites, 13 invariants | 3 suites (backstop, credit, allocator) |
| Fork | 10 mainnet + 8 testnet | about 15 (liquidation venues with BTC mock, Vault V2, come-back) |
| Live testnet scripts | 3 | 6 (canary liquidation, bribe, allocator move) |

Run Slither and Aderyn in CI.

## 8. Deployment

**Wave 1 (testnet 31611).** Scripts run in this order, each with `--broadcast --account <ks> --gas-estimate-multiplier 110`, CREATE2 salts `baserate.<name>.v1`, and assertions after every step:
1. `01_DeployOracle(PYTH, feeds)`.
2. `02_DeployWsMUSD(MUSD, sMUSD, SAFE, 250_000e18)`, then a seed deposit of 1e18 to `0x…dEaD`.
3. `03_DeployCore`: `BorrowAccountFactory(...)`, then `MORPHO.createMarket(P)`; assert the id and `lastUpdate`.
4. `04_SeedMarket`: `MUSD.approve(MORPHO)`, then `MORPHO.supply(P, ≥300e18, 0, treasury, "")`.
   - About 4 faucet drips: `BTC.approve(router)` on the precompile, then `swapExactTokensForTokens(amt, min, [Route(0x7b7C…00, 0x1189…, false, 0x4947…)], to, dl)` on `0x9a1f…`. Alternatively DevRel funding.
5. `05_DemoBorrow`: `factory.openAndBorrow{value: 0.0009e18}(40e18, 5000)`.
6. `06_ExportRegistry` writes `deployments/31611.json` and exports `abi/`.

Verify each contract (including the brBTC and implementation the factory created) with:
```
forge verify-contract <addr> <path:Name> --chain-id 31611 --verifier blockscout --verifier-url https://api.explorer.test.mezo.org/api --constructor-args <enc>
```
and again with `--verifier sourcify`.

**Wave 2 order:**
- **Nov 2:** testnet submits timelocked operations: `setFeeRecipient` → FeeRouter, `setModuleApproval(CreditLineModule)`, limit raises.
- **Nov 6–8, mainnet (31612):**
  1. FeeRouter (`DeployPeriphery.s.sol` with `TREASURY`; with no factory in the registry it deploys only the router).
  2. Oracle, wsMUSD, factory and M1 at 0.86 / IRM `0x3760…` with `Deploy.s.sol`. On 31612 it requires `GOVERNOR` (the Safe), `SENTINEL` and `FEE_RECIPIENT` (the FeeRouter, passed to the constructor so no timelock is needed), and none of them may be the deployer. `DeployPeriphery.s.sol` with `FEE_ROUTER` then adds the RiskLens and checks `factory.feeRecipient() == feeRouter`. Both scripts write the registry only on `--broadcast` and merge into it.
  3. vMUSD configuration (§4).
  4. Allocator, Backstop, FlashLiquidator, RiskLens, CreditLineModule.
  5. Submit the module approval.
  6. Seed (≈2–3k MUSD across M1 and vMUSD), the evidence transactions (borrow, repay, canary liquidation, allocator move, bribe), then verify everything.

**Registry (`deployments/<chainId>.json`, consumed by the app and keeper):**
```json
{"chainId":31611,"version":"w1","block":0,
 "external":{"morpho":"0xCe1d…","irm":"0x0c97…","musd":"0x1189…","smusd":"0x6f46…","pyth":"0x933a…","skip":"0x7b7c…0015","btc":"0x7b7C…0000","bos":"0xD757…","collSurplusPool":"0xB4C3…","pcv":"0x4dDD…"},
 "contracts":{"oracle":{"address":"","tx":"","block":0},"wsMUSD":{},"factory":{},"brBTC":{},"borrowAccountImpl":{}},
 "markets":{"M1":{"id":"","loanToken":"","collateralToken":"","oracle":"","irm":"","lltv":"770000000000000000"}},
 "params":{"ceilingBps":{"standard":6200,"canary":7675},"positionCapWei":{},"globalBorrowCap":"","originationFeeBps":10,"wsMUSDCap":"","timelocks":{"factory":172800,"wsMUSD":259200}},
 "roles":{"governor":"","sentinel":"","feeRecipient":"","canaryOperators":[]}}
```

## 9. What is final in Wave 1, and what may be redeployed

- **Final in Wave 1:** BtcMusdOracle and WsMUSD. Mainnet reuses the same bytecode with network parameters; Wave 2 consumes their interfaces (adapter, backstop, lens).
- **Designed to survive, but acceptable to redeploy on testnet:** brBTC, the factory and the BorrowAccount implementation. Wave 2 extension points are already in them: module hook, `comeBack`, `supplyIdle`, `receive`, canary profile, timelocked fee recipient. If Wave 2 testing finds a defect, redeploy that set and M1 together on testnet as "v2" (the seed moves with `withdraw`/`supply`; the registry is versioned; the Wave 1 evidence transactions stay valid). Mainnet deploys once, in Wave 2, after the fork tests.
- **Wave 2 only adds contracts:** adapters, vMUSD, allocator, FlashLiquidator, Backstop, FeeRouter, RiskLens, CreditLineModule.
- **Never redeploy after mainnet launch without a user-driven migration:** anything holding funds (wsMUSD, M1 positions, vMUSD, bMUSD).

## 10. Wave 1 contract build order (about 23 h of the 57 h)

| Hours | Work |
|---|---|
| 0–2 | Scaffold, dependencies, `foundry.toml`, fork smoke test (Morpho read plus SkipMock etch) |
| 2–5 | Oracle and tests |
| 5–11 | brBTC, BorrowAccount, factory; unit and fuzz tests |
| 11–15 | wsMUSD and tests |
| 15–19 | Mainnet and testnet fork suites, two invariant suites |
| 19–23 | Testnet deploy, verify, seed, real `openAndBorrow`, registry |

If time runs short, cut in this order: fork invariants (keep local ones), then `comeBack` tests (the code stays and is tested in Wave 2), then `redeemInKind` fork tests.

### Critical Files for Implementation
- /Users/oluwademilade/Desktop/mezo/contracts/src/account/BorrowAccount.sol
- /Users/oluwademilade/Desktop/mezo/contracts/src/account/BorrowAccountFactory.sol
- /Users/oluwademilade/Desktop/mezo/contracts/src/collateral/BrBTC.sol
- /Users/oluwademilade/Desktop/mezo/contracts/src/savings/WsMUSD.sol
- /Users/oluwademilade/Desktop/mezo/contracts/src/oracle/BtcMusdOracle.sol
