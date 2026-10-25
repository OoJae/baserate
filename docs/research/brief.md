# Mezo Buildathon: consolidated research brief

**Snapshot:** 2026-10-23 ≈24:00 UTC, Mezo mainnet block ≈12.718M. This merges the seven researcher reports (MUSD mechanics, Earn/MEZO, infra and cross-chain, ecosystem metrics, competitors, analogues, judges). I re-checked the main conflicts with read-only `cast` and public-API calls; those re-checks are marked **[RL]**.

Labels:
- **[V]** verified on-chain, in verified source, or in a primary API/page.
- **[D]** docs or blog only.
- **[I]** inference.
- **[U]** unverified.

Mainnet RPC is `https://mezo-mainnet.boar.network` (chainId 31612); testnet is `https://rpc.test.mezo.org` (31611). "Docs" means `github.com/mezo-org/documentation`; many docs addresses and descriptions are stale (see §h).

## 0. Ten facts that should drive the choice

1. **Retail MUSD borrowing has collapsed to one trove.**
   - `TroveManager.getTroveOwnersCount()` = 1, with 14,488.6 MUSD debt and 16.589 BTC.
   - History: 104 troves / 6.03M debt (2025-11-30), 54 / 5.40M (2026-04-26), 14 / 0.80M (2026-09-30) [V].
   - The last trove cannot be closed or fully redeemed, so remaining redemption capacity is ≈12.5k MUSD.
2. **MUSD has sat below its redemption floor for months.**
   - Daily price $0.9885–0.9911 for 60 days (CoinGecko); live Pyth 0.98938 [RL]. The 0.75% redemption fee implies a ≈$0.9925 floor.
   - 681 redemptions burned 1,276,615 MUSD in ≈30 days [V].
   - [I] While this lasts, any new mainnet trove with a lower ratio than the survivor is first in the redemption queue, and its owner absorbs the ≈1% discount. Trove-centric products, including most of the top competitors, demo fine on testnet but are hostile to users on mainnet today.
3. **Two institutional Enclaves are most of Mezo.**
   - They hold 1,000.2 of the 1,117.1 BTC on Mezo and 750.2 of the 804.53 BTC in veBTC.
   - They owe 14.5M MUSD through `EnclaveDebtManager`, which is permissioned, at its cap, priced at 1%, and has no redemption or liquidation path [V].
   - Another 14.95M MUSD is the PCV bootstrap loan; 14.17M of it sits idle in the Stability Pool.
   - Organic retail MUSD is roughly $1–3M [I].
4. **The composable rails exist but are empty.**
   - Mezo's Morpho Blue has exactly one market: BTC collateral, mUSDC loan, 81.9k supplied (1 `CreateMarket` log) [RL].
   - Nothing lends MUSD on Mezo. Morpho MUSD markets on Ethereum hold under $100 combined, and there are none on Base [RL].
   - Market creation is permissionless: mainnet LLTV 86%; testnet is a separate deployment with LLTV 77%.
5. **sMUSD is not ERC-4626.**
   - It does 1:1 deposit/withdraw plus a separate `yieldIndex`/`claimYield()`. `asset()` and `totalAssets()` revert. The docs' "exchange rate" description is wrong [V].
   - The one submitted sMUSD auto-compounder (Mezo Flow) is coded against a non-existent 4626 `deposit(assets, receiver)` and is tested only against a mock [RL].
6. **sMUSD's realized yield is ≈3.2%, and the 10,000 MUSD/week paid to sMUSD-gauge voters is running down a backlog.**
   - `ProtocolYieldReceived` events total 19,367 MUSD for 2026-09-23→10-22 [RL].
   - FeesVotingReward paid exactly 10,000 MUSD in every sampled epoch since May [RL].
   - The gauge's 72% share of sMUSD accrues only ≈3.3k MUSD/week. Its claimable backlog is 58,981 MUSD [RL], which is ≈8–9 weeks of runway at current rates [I].
   - Today's ≈44 MUSD per boosted vote-unit per week falls to ≈15 once the backlog is gone.
7. **MEZO is near its all-time low.**
   - Price ≈$0.0029; market cap ≈$1.47M; FDV ≈$2.95M; −98% from $0.1485 (2026-04-13).
   - Weekly emissions of ≈4.7M MEZO are worth ≈$13.7k.
   - MEZO-denominated incentives and the $7k MEZO prize pool are small in USD.
8. **Zero of 40 submissions deploy on Base, Ethereum or BNB.** MUSD does not exist on BNB Chain (no code at the MUSD address); MEZO on BSC totals 19,034 [RL].
9. **The judges' bar.**
   - civ_defi_mezo, 2026-10-19: "it works as expected; users can fully test all features; no clear security flaws" [V].
   - Kickoff: be "close to a live product on mainnet"; mockups find it "very hard … to win"; testnet is OK but mainnet is "valued more"; loss of funds is the fatal mistake; AI audits are accepted.
10. **The clock.**
    - Wave 1 closes **2026-10-26 15:00 UTC**, ≈63 h after this snapshot.
    - Wave 2 builds Nov 2–15 for $5,000 (vs $2,000 in Wave 1) and is judged Nov 16–22.
    - AKINDO's page says "Ship in Wave 1, get scored, improve, and submit again in Wave 2"; Mezo's blog says "Eligible projects advance to Wave 2."
    - Across 11 AKINDO programs, 80% of wave-2+ payouts went to products that had submitted earlier [V].

## (a) Mezo primitives and exact integration hooks

**a1. Chain**
- Working mainnet RPCs: `mezo-mainnet.boar.network`, `jsonrpc-mezo.boar.network`, `mainnet.mezo.public.validationcloud.io`, `mezo.drpc.org`.
- `rpc.mezo.org` is dead, and it is viem's built-in `mezo` default, so override it.
- For logs use Blockscout `api.explorer(.test).mezo.org` (`/api/v2` and the Etherscan-style `/api`). RPC `eth_getLogs` is capped at 10k blocks.
- The gas token is BTC (18 decimals). It is also the ERC-20 precompile `0x7b7C000000000000000000000000000000000000` (with permit), and both views share one balance, so never count them separately.
- MEZO is the precompile `0x7B7c000000000000000000000000000000000001` (with permit).
- Mezod 13.0.1 with Prague/Osaka active (EIP-7702, P256VERIFY). PREVRANDAO = 0, self-destruct is disabled, and the block gas limit is 10M.
- **At most 20 precompile executions per transaction, reads included** [V].

**a2. MUSD CDP.** A Liquity v1 / thUSD fork in `mezo-org/musd` (GPL-3.0); ABIs are in npm `@mezo-org/musd-contracts` 1.1.0.

| Contract | Mainnet | Testnet |
|---|---|---|
| BorrowerOperations | 0x44b1bac67dDA612a41a58AAf779143B181dEe031 | 0xCdF7028ceAB81fA0C6971208e83fa7872994beE5 |
| BorrowerOperationsSignatures | 0xB57ab578BF20b3e318f3EFAA587C51DBccE5df7a | 0xD757e3646AF370b15f32EB557F0F8380Df7D639e |
| TroveManager | 0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193 | 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0 |
| StabilityPool | 0x73245Eff485aB3AAc1158B3c4d8f4b23797B0e32 | 0x1CCA7E410eE41739792eA0A24e00349Dd247680e |
| PCV | 0x391EcC7ffEFc48cff41D0F2Bb36e38b82180B993 | 0x4dDD70f4C603b6089c07875Be02fEdFD626b80Af |
| PriceFeed | 0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88 | 0x86bCF0841622a5dAC14A313a15f96A95421b9366 |
| HintHelpers | 0xD267b3bE2514375A075fd03C3D9CBa6b95317DC3 | 0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6 |
| SortedTroves | 0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f | 0x722E4D24FD6Ff8b0AC679450F3D91294607268fA |
| CollSurplusPool | 0xBF51807ACb3394B8550f0554FB9098856Ef5F491 | 0xB4C35747c26E4aB5F1a7CdC7E875B5946eFa6fa9 |
| MUSD (not a proxy) | 0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186 | 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503 |

- **Parameters (same on both networks) [V]:**
  - MCR 110%, CCR 150%, a 200 MUSD gas reserve, and a 0.5% collateral bonus to liquidators.
  - `minNetDebt` 1,800 MUSD (2,000 total with the gas reserve).
  - Fees: borrowing 0.1%; redemption 0.75%, paid in BTC; refinance 0.02% of net debt.
  - The interest rate has been 100 bps since May 2025. Interest is simple and fixed per trove at open, and additional borrowing accrues at the trove's own rate.
  - PCV `council()` and `treasury()` are both 0x0, so the rate and fees cannot change until the owner multisig `0x98D8899c3030741925BE630C710A98B57F397C7a` sets those roles.
- **Capacity lock.** `maxBorrowingCapacity = coll × price / 1.1` is set only at open and at `refinance`. Adding collateral or a BTC rally does not raise it.
- **Recovery Mode** (TCR < 150%) blocks collateral withdrawal, `closeTrove` and `refinance`.
- **Ownership.** One trove per address, and troves cannot be transferred. Contracts can own troves but need a `receive()` function; Mezo's SafetyBuffer `0xb0c9a818a4e5d9184e5c9108a144e607dea90100` is a live example.
- **Calls:**
  - `openTrove(debt, upperHint, lowerHint) payable`
  - `adjustTrove(collWithdrawal, debtChange, isDebtIncrease, upper, lower) payable`
  - `addColl`, `withdrawColl`, `withdrawMUSD`, `repayMUSD`, `closeTrove()`, `refinance(upper, lower)`, `claimCollateral()`
  - `TroveManager.redeemCollateral(amount, firstHint, upperPartialHint, lowerPartialHint, partialNICR, maxIterations)`, `liquidate`, `batchLiquidateTroves`
  - `HintHelpers.getRedemptionHints(amount, price, maxIter)`
  - `SortedTroves.getLast()`, which is the next redemption target.
- **Redemption order** follows NICR = collateral / principal, which ignores accrued interest. A partial redemption must leave at least 1,800 net debt.
- **Event decoding.** `TroveUpdated` operation codes overlap between BorrowerOperations and TroveManager, so key on the emitting contract.
- **MUSD token.** OpenZeppelin ERC20Permit (domain "Mezo USD" v1, ecrecover only); no ERC-3156 flash loans. The mint list is BorrowerOperations, InterestRateManager and EnclaveDebtManager, so builders can only mint MUSD by opening troves.

**a3. Delegated trove operations (`BorrowerOperationsSignatures`)**
- EIP-712 domain: {"BorrowerOperationsSignatures", "1", chainId, proxy}.
- Nine signed actions: OpenTrove, AddColl, WithdrawColl, RepayMUSD, WithdrawMUSD, AdjustTrove, CloseTrove, Refinance, ClaimCollateral. Each is called as `*WithSignature(…, sig, deadline)`; hints are passed outside the signature.
- **ECDSA only, with no EIP-1271**, so Passport/OrangeKit smart accounts cannot sign. There is one sequential nonce per borrower and no cancel function.
- The caller supplies the BTC, or has its MUSD burned for repay/close. Outputs go to the recipient named in the signature.
- Signatures carry no price conditions, so any relayer contract must enforce its own [V].

**a4. Stability Pool, PCV and Enclaves**
- **Stability Pool:**
  - Calls: `provideToSP`; `withdrawFromSP(0)` claims BTC gains (non-zero withdrawals revert while any trove is below 110%); `withdrawCollateralGainToTrove`.
  - Rewards are BTC liquidation gains only.
  - Mainnet holds 14,172,052 MUSD, of which the PCV owns 14,172,032. There have been 28 liquidations ever [V].
- **PCV:**
  - `distributeMUSD()` is permissionless. It sends 50% of interest and fees to sMUSD and 50% to repaying the bootstrap loan (`debtToPay` is 14.95M of the original 100M).
  - Redemption-fee BTC goes through YieldConverter `0x5acC3E627AFCf6a9e51E82a879291Df68376d1c5` to sMUSD.
  - Anyone can call `depositToStabilityPool`, but withdrawals go only to whitelisted recipients.
  - PCV rebalancing is a manual monthly procedure (`musd/docs/rebalancing.md`).
- **EnclaveDebtManager**, proxy `0x2C5e9aFBb670c4A61aC2DcAD62C258eE2391389a` (verified implementation `0x3Ea98a11D349B515e628C1CC74ca999230744C43`):
  - `ENCLAVE_ROLE`-gated MUSD minting against pledged veBTC, with a 150% warning CR and a 110% minimum.
  - It is the reference design for veBTC-backed credit; builders can only read it.

**a5. Savings vaults**
- **sMUSD** (`MUSDSavingsRate`, MIT) at `0xb4D498029af77680cD1eF828b967f010d06C51CC`:
  - Functions: `deposit(uint256)`, `withdraw(uint256)` (auto-claims), `claimYield()`, `claimableYield(addr)`, `yieldIndex()`, and `receiveProtocolYield(uint256)`, which lets **anyone donate yield**.
  - Supply is 7,382,555 [RL]. The principal sits in IdleStrategy `0x0C0944713c185ea3e64F5609ECee3fB3C054a295`.
  - VaultGauge `0x677817bF3e44b90E8F95222F75e2950b7904a401` holds 72% of supply, ≈5.25M of it from Enclave A.
  - Stakers earn MEZO (≈0.77% per DefiLlama). Their MUSD yield goes to veBTC voters through FeesVotingReward `0x33b8B1162F0b86d68CAd418D96246Ee2c5164a01`, capped at 10,000 MUSD per claim.
  - Unstaked holders earn ≈3.2% realized (DefiLlama shows 4.23%).
  - sMUSD is not whitelisted on PoolsVoter [RL].
  - On testnet (`0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16`), `pcv()` = 0 and `vaultGauge()` = 0. A gauge `0xA6972f35550717280f2538EA77638B29073e3F07` stakes it but is not wired in [RL], so simulate yield with `receiveProtocolYield`.
- **Ditto dMUSD** `0x9171Cb787C3fEEbBC808D07CaB62B1d789CE14F8`: ERC-4626 plus asynchronous redemptions into Spark; ≈105k MUSD.
- **USDC Lending Vault**, which is Mezo's own template for a lending vault with a gauge:
  - Morpho Vault V2 `0x06291b67e3d7660240ab44Afc9a708d82b976a8B`
  - adapter `0xb0EE3a01d9134733155B28289c09f084Acca4F61`
  - ERC4626VaultAdapter `0xd3f6F147662Bf2943ca09ee16beDaEa28AE28788`
  - gauge `0x11E98DEc5B1965E4eB872552E64Ef8580bBBbae7`; interest is redirected to veBTC voters.

**a6. Mezo Earn.** An Aerodrome-style ve(3,3) system. Its source repo is private, but the contracts are verified on Blockscout.
- **Live mainnet contracts.** The docs instead list a dead v1 VeBTC (`0x7D80…5914`) and Voter (`0x3A4a…2C1b`).

| Contract | Address | Notes |
|---|---|---|
| VeBTC | 0x3D4b1b884A7a1E59fE8589a3296EC8f8cBB6f279 | |
| VeMEZO | 0xb90fdAd3DFD180458D62Cc6acedc983D78E20122 | |
| PoolsVoter | 0x48233cCC97B87Ba93bCA212cbEe48e3210211f03 | 28 gauges |
| BoostVoter | 0x2ba614a598cffa5a19d683cdca97bac3a49313d1 | 719 gauges |
| ValidatorsVoter | 0xe99a9ad5Ed26BD30e4DB25397f378817e9b9515a | |
| ThirdPartyVoter ("MEZO Gauges") | 0x2e6D2F2CaCC1d24F9f9358030674eB307397A6EB | |
| GaugeFactory | 0x4150DcE1c6d013fa7EBaf4fFCd879D08daA0CCAd | |
| MEZOMinter | 0x66Bff681611553b3204A226b2019ec621F39ffc3 | |

- **Locks:**
  - veBTC locks for at most 28 days; veMEZO for at most 4 years. Both support permanent locks.
  - `split` is team-gated. `withdraw` needs an expired lock plus `reset`.
  - A veNFT that has voted can still be transferred.
  - Gauge votes can be delegated only through ERC-721 approval, which also grants transfer rights.
- **Managed NFTs.** Only the governor can create them (`allowedManager()` = 0). Boar's veBTC #1226 (2.244 BTC, 5x) and Aurove's #6107 (0.0085 BTC) exist and work [RL].
- **Boost:**
  - Formula: `min(5, 1 + 4 × (veBTC unboostedTotalVP / NFT unboostedVP) × (gauge veMEZO weight / all veMEZO VP))`.
  - The value only refreshes when someone calls the permissionless `pokeBoost`.
  - A 5x boost on 1 BTC needs ≈154.5k veMEZO voting power, about $450 [I]. Non-permanent veBTC averages only ≈1.06x.
- **Permissions:**
  - `createPoolGauge(factory, pool)` is permissionless when both tokens are whitelisted. The mainnet whitelist is BTC, MEZO, MUSD, mUSDC, mUSDT, mcbBTC, SATS, avBTCm and avMEZOm.
  - Governor only: vault, no-fee and third-party gauges, token whitelisting, managed NFTs.
  - Bribes require whitelisted tokens.
  - Boost gauges are created on demand by the NFT owner.
- **Epochs.** Each starts Thursday 00:00 UTC. Each NFT has one vote that persists across epochs. `poke` is permissionless. Votes cast in epoch N set emissions for epoch N+1.
- **Flows in epoch 28 (Oct 22):**
  - Minted 4,717,276 MEZO. Of that: rebase 1,967,768; validators ≈549.9k; pool and vault gauges ≈1.80M; MEZO Gauges ≈396k. The ecosystem splitter needle has moved from 90 to 82.
  - veBTC earns fees and bribes, not MEZO: the sMUSD gauge pays 10,000 MUSD; pool gauges pay ≈$45–540; chain fees total 0.003–0.016 BTC/week.
  - Boost bribes totalled ≈$464 over the last 3 weeks. MEZO Gauges have never received a bribe.
  - MEZO Gauges direct emissions to Uniswap v4 USDC/MUSD, Aerodrome USDC/MUSD and MEZO/MUSD (Base), and Curve MUSD.
- **Enclave positions.** Enclave #6033 (250.15 BTC, permanent, 5x) holds 71% of veBTC voting power. Enclave #6114 (500.07 BTC, 1x) unlocks on **2026-11-12**.
- **Meta-transactions:**
  - VeBTC `forwarder()` = 0.
  - PoolsVoter, BoostVoter and sMUSD still trust MezoForwarder `0xE6F919e62c370Ef04EDF4cA5E2a901Ea1aa87085`, but it has had no transactions since 2026-10-05, and Mezo says meta-transactions are "disabled altogether" [RL]. Treat them as unavailable.
- **Testnet:**
  - VeBTC `0x38E35d92E6Bfc6787272A62345856B13eA12130a` is the one wired to the voter; the docs' `0xB63f…9231` is not [RL].
  - VeMEZO `0xaCE816CA2bcc9b12C59799dcC5A959Fb9b98111b`.
  - PoolsVoter `0x263F1Fd5fB7F866881e1B6cD7d5d6c40Fd985F0D` whitelists MUSD and MEZO, but not BTC, mUSDC or sMUSD [RL].
  - BoostVoter `0x21d7bDF5a5929AD179F8cA0c9014A0B62ae6Bfd1`.
  - ThirdPartyVoter `0x62FE6d71BE2Ac2806Da046bf93b02C279246251D` has no whitelisted tokens.

**a7. DEX.** Velodrome V2-style basic pools plus Slipstream concentrated-liquidity (CL) pools.
- **Mainnet contracts:**
  - PoolFactory `0x83FE469C636C4081b87bA5b3Ae9991c6Ed104248`.
  - Router `0x16A76d3cd3C1e3CE843C6680d6B37E9116b5C706`: `swapExactTokensForTokens(amountIn, minOut, Route[]{from,to,stable,factory}, to, deadline)`. The docs' `address[]` path is wrong. `Router.voter` is unset, so zap-and-stake fails.
  - CLFactory `0xBB24AF5c6fB88F1d191FA76055e30BF881BeEb79`; NFPM `0x509Bc221df2B83927c695FA0bb0f5B21053C874c`.
  - CLSwapRouter `0x37cDd11919ec3860eaD9efB8673d7476E5326225` is keyed by tickSpacing and is **not** ABI-compatible with Uniswap V3.
  - QuoterV2 `0x4e56af2d49d3d8f9a99155b31dd117ccdd545dc7`; LpSugar `0x4e7057d4f6c0cee6eeb2b5fec193a9b5d1961ae1`.
  - Flash liquidity: `CLPool.flash()` and `Pool.swap(…, bytes)`.
- **Mainnet pools:**

| Pool | Address |
|---|---|
| mUSDC/MUSD CL10 | 0xCC372B7E15535aB225fe17c1075831D38ef7aC1a |
| BTC/MUSD CL200 | 0x9CBc1537d255768b431488305b1C7EFc2ac95022 |
| BTC/MUSD vAMM | 0x52e604c44417233b6CcEDDDc0d640A405Caacefb |
| mUSDC/MUSD sAMM | 0xEd812AEc0Fecc8fD882Ac3eccC43f3aA80A6c356 |
| MUSD/mUSDT | 0x10906a9E9215939561597b4C8e4b98F93c02031A |
| MEZO/MUSD CL200 | 0x1D6e8D24c133535F2d00676F66a0e824f84765ff |

- **Testnet:**
  - Router `0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9`; PoolFactory `0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A`.
  - CLFactory `0x7B61BC8Aa460476d142F1CD107A47297002f69ff`; CLSwapRouter `0x3112908bB72ce9c26a321Eeb22EC8e051F3b6E6a`; NFPM `0x9B753e11bFEd0D88F6e1D2777E3c7dac42F96062`.
  - The MUSD/BTC pool `0xd16A5Df82120ED8D626a1a15232bFcE2366d6AA9` is deep: 102.6M MUSD and 1,303 BTC.

**a8. Morpho**
- **Mainnet** Morpho Blue `0x565834cE7E40b8987BC20EbF83E2159467bDA311`, owned by the Mezo multisig:
  - `createMarket((loanToken, collateralToken, oracle, irm, lltv))` is permissionless, but only AdaptiveCurveIrm `0x3760ebc636f912a4db9540fda4dec09c25c6c1e7` and LLTV 0.86e18 are enabled.
  - `flashLoan` is fee-free, but the contract holds only ≈1.154 BTC and ≈15.5k mUSDC.
  - The only market is `0x6f88e79e8acb3a3ac2f990dcfb83b42ddae96ef406cd735f1721b2a2e1b733db`: loan mUSDC `0x04671C72Aab5AC02A03c1098314b1BB6B560c197`, collateral BTC, oracle `0xea0597d3d44ff2ea1e4c35501e153f4c025e48d1`, ≈81% utilised.
  - The Morpho API does not index chain 31612.
- **Testnet** Morpho Blue `0xCe1da828cA15cb1FDAfa84C366A53C8106655a73`, at a different address from mainnet:
  - LLTV 0.77 is enabled; 0.86 is not.
  - IRM `0x0c97fe017628636649ff374ad499529f91167441` is enabled.
  - One market: testnet mUSDC `0xe1a26db653708A2AD8F824E92Db9852410e33A59` against BTC [RL].
  - Vault V2 `0x9F9b82ab72C3418B617357f4f5E501D22366dF08`.
- **Dormant vaults.** The "Mezo Morpho {MSTR, COIN, BTDR, DEFT, FLD, GLXY} Vault" tokens on mainnet are MUSD vaults holding 1 wei. They were redeemed on 2026-06-26 by EOA curator `0x44EC46F7B5Ff434b5F13F030D0A15495a897c38B` [RL], so this is an abandoned experiment.

**a9. Oracles**
- **Skip Connect** precompile `0x7b7c000000000000000000000000000000000015`:
  - Chainlink AggregatorV3 interface, 18 decimals, **BTC/USD only**, updated every block.
  - `PriceFeed.fetchPrice()` reverts if the price is more than 60 s old, and there is no fallback.
- **Pyth:**
  - The docs' address `0x2880aB155794e7179c9eE2e38200202908C17B43` is **stale**: its MUSD price was last published 2026-07-17 [RL].
  - The live "Pyth Core Compatible" contracts are mainnet `0x5D289Ad1CE59fCC25b6892e7A303dfFf3a9f7167` (MUSD 0.98938, 19 s old) and testnet `0x933aDeC2C7624b11E4B2b80ACE15BF9a71a31315` [RL].
  - Live feeds: BTC, MUSD (`0x0617a9b725011a126a2b9fd53563f4236501f32cf76d877644b943394606c6de`), MEZO, USDC, USDT, cbBTC and T.
  - The update fee is 0. The MUSD feed is pushed on a 1% move or every 3,600 s.
- **Other providers.** Stork and Supra are testnet-only and inactive. There is no Chainlink, RedStone or VRF on Mezo [V].

**a10. Accounts, payments and data**
- **Passport / OrangeKit.** Bitcoin wallets get Safe smart accounts, relayed by Mezo. Native BTC-wallet sign-up and bridge-in are being sunset, so default to EVM wallets.
- **Account abstraction.** EntryPoint v0.7 `0x0000000071727De22E5E9d8BAf0edAc6f37da032` is deployed but has 0 transactions, and there is no bundler or paymaster. Permit2, Multicall3 and Safe 1.4.1 are deployed. EIP-7702 transactions are accepted.
- **x402.** The facilitator `https://facilitator.vativ.io` settles MUSD and BTC and sponsors gas. Settlement proxy: `0x402085c248EeA27D92E8b30b2C58ed07f9E20001`. Its mainnet signer has sent only 22 transactions.
- **Mezo ID.** `GET https://api.mezo.org/accounts/{name}.mezo` (undocumented).
- **Data.** Goldsky, Envio, Sourcify and Dune all work. There is no public Mezo subgraph.

## (b) What already exists (do not duplicate)

**Native Mezo:**
- MUSD core: the CDP, Stability Pool and PCV, plus EnclaveDebtManager.
- **SafetyBuffer**, a Mezo-run trove that absorbs redemptions. Its keeper is `0x1cBbC5f210031fF947F4a17D87fcFbBe02A7a8f7`; it has done more than 1,000 rebuys and is now closed by redemption.
- In-house bots for liquidation, Earn, Pyth updates and poke.
- sMUSD with its gauge and YieldConverter; the USDC Lending Vault; Ditto dMUSD.
- Mezo Earn, including Pair & Boost and claim-all.
- MEZO Gauges: Merkl on Ethereum, Aero on Base.
- Wormhole NTT bridging.
- Get Gas (permit → 0.0001 BTC), Mezo Market (Bitrefill), Mezo ID, Passport, the Safe UI, and the x402 facilitator.
- Mezo Prime (Anchorage, Bullish).
- **Roadmap items Mezo plans to ship itself** [D]: a veNFT marketplace, voting delegation, a Grant Committee, a splitter voting UI, "A Simpler Earn Experience", cards, AI-agent rails, more vaults, and "a broader suite of lending markets".

**Community:**

| Project | What it is |
|---|---|
| Aurove | Liquid ve tranches; live on mainnet but negligible TVL |
| Matchbox | Manual boost and incentives UI, including Remote MEZO Gauges |
| Boar Finance | Custodial auto-voter built on a managed veBTC NFT; ≈$182k |
| Vezo | veNFT marketplace |
| VeMezoPool | Buys veMEZO at 50% of the locked amount |
| Range | ERC-4626 CL rebalancer |
| Mezo Tools, veBoost Calculator, Antwyr, MezoAgent | Analytics and tools |
| Upshift upMUSD | MUSD vault, 48k |
| Mellow BTC vault | Winding down 2026-10-28 |

**Prior Mezo hackathon winners:**
- H1: TrovePilot (keepers), BTCShield, StratumFi (self-repaying loans), KhipuVault, BitSpend, CreatorBank, Invoiced, BountyPay, MezoLotto.
- H2: Cermin (auto-managed trove), TreasuryOS, AdaptiveGuard, Cark, MezoPay, SuperPage (x402), Mezoir (ve agent), BynD (pooled veMEZO), Fractals (fractional ve).
- Also: an unmerged Microloans.sol in mezo-org/musd.

## (c) Ecosystem metrics and gaps

| Metric | Value |
|---|---|
| DefiLlama TVL | $72.2M: Earn $65.4M, Vaults $7.44M, Tigris V3 $5.34M, Borrow $1.35M, Boar $182k |
| BTC on Mezo / in veBTC | 1,117.1 / 804.53 BTC; 6,161 veBTC NFTs across 1,796 holders; 283.4 BTC permanently locked |
| veMEZO | 280.69M MEZO locked; 98.73M voting power |
| MUSD supply | 29,482,017 = PCV loan 14.95M + Enclave debt 14.52M + troves 14.5k |
| Where MUSD sits | Stability Pool 14.17M; sMUSD 7.38M; mUSDC/MUSD CL pool 5.33M; NTT lockbox 1.635M |
| Main stable pool | 5,333,831 MUSD vs ≈8,455 mUSDC, at 0.9896 |
| Other liquidity | BTC/MUSD vAMM: 0.475 BTC + 39.3k MUSD; BTC/MUSD CL200: 0.394 BTC + 15.7k MUSD; MEZO/MUSD: ≈1.27M MEZO vs ≈1.4k MUSD; mUSDC supply 122k |
| Activity | 62,802 addresses; ≈946 tx/day; DEX volume $2.45M per 30 days; chain fees $28.3k per 30 days |
| Redemptions and liquidations | 1,155 redemptions / 5.86M MUSD lifetime; 28 liquidations; 5.70 BTC unclaimed in CollSurplusPool |
| Testnet | 304 troves; TCR 291.8%; Stability Pool 86.23M; MUSD supply 523.8M; one trove at ICR ≈109.4% has gone unliquidated for ≈262h |

The order book is lopsided. Enclave A holds 5.26M MUSD in a single-sided range at ≈$0.991–1.002, which acts as an ask wall just above the market. USDC on the bid side is only ≈$0.38M across Mezo, Base and Ethereum combined.

**Gaps [I]**, ranked by utility × feasibility:
1. No venue lends MUSD at size, and sMUSD cannot be used as collateral.
2. No way to borrow MUSD against BTC without redemption risk; USDC borrowing is capped by the 122k mUSDC supply.
3. No USDC bid to absorb MUSD sellers.
4. Retail veBTC holders (≈54 BTC) cannot borrow against it.
5. No third-party automation.
6. No looping router, and liquidity is thin.
7. MUSD on Base and Ethereum has no lending use.

## (d) Cross-chain presence

**MUSD (Wormhole NTT v1.1.0)**
- Mezo's manager `0x7efb386675d75280D39Aae42964A6776DE0ee0bD` locks 1.635M MUSD.
- Burning managers: Ethereum `0x5293158bf7a81ED05418DA497a80F7e6Dbf4477E` and Base `0x3EB418BdBE95b4b9cf465ecfBD8424685ACD1Bc1`.
- MUSD uses the same token address on all three chains. Inbound limit is 10M per 24h per peer. Wormhole chain IDs: Mezo 50, Ethereum 2, Base 30.
- Supply: Ethereum 608.8k, Base 1.016M [RL]. **None on BSC, Solana or Robinhood.**
- Testnet: Sepolia `0xeB5a5d39dE4Ea42C2Aa6A57EcA2894376683bB8E` (141.7M) and Base Sepolia `0x560985f804De8187E8FBA94F7127Bc4c0e54AEA5` (4.5k). Testnet transfers need a manual redeem.

**MEZO (NTT v1.3.1)**
- Mezo's manager `0x5E668D912F69db0762CD0fE00647dA9fa6b29591` locks 307.6M MEZO.
- Remote supply: Base 285.2M, Ethereum 21.66M, BSC 19,034, Robinhood Chain 42, plus Solana.
- EVM token: `0x8e4cbBcc33dB6c0a18561fDE1F6bA35906d4848b`.
- The Terms of Participation also list Robinhood as an eligible chain; the AKINDO page omits it [U].

**Venues**
- **Base:**
  - Aerodrome USDC/MUSD `0xb02FdA984EddfF593202eD2B5a6dE043B9b62Ea5` holds 926.3k MUSD + 228.8k USDC [RL] and yields ≈0.97%.
  - Its LPs are migrating to **Aero**, which went live on 2026-10-22. The new pool addresses are not yet published.
  - MEZO/MUSD on Base is ≈$5k.
- **Ethereum:**
  - Curve MUSD/crv2pool `0xB5571E76693ba60110B5811DD650FFefce1C955f` is ≈$650k. Selling 100k MUSD costs ≈4%. It yields ≈12.7% from Merkl veMEZO, and Convex and Stake DAO wrap it.
  - Uniswap v4 USDC/MUSD is ≈$67.8k.
- **Ticker trap:** DefiLlama's $2.49M "USDC-MUSD" Uniswap v4 pool is actually MetaMask mUSD (`0xacA92E43…35DA`), and "MUSD-3CRV" is mStable's mUSD [RL].
- **Morpho:** MUSD markets hold under $100 in total [RL].
- **Bridging BTC:** BTC now arrives as tBTC through MezoBridge `0xF6680EA3b480cA2b72D96ea13cCAF2cFd8e6908c`; native bridge-in closed 2026-10-13. Bridging out to Bitcoin has a 0.01 BTC minimum.

## (e) Competitor landscape

**Snapshot (AKINDO API, re-pulled [RL])**
- 40 submissions and 173 registered builders; 7 submissions are placeholders.
- Only Pylon and MezoRoute have contracts on mainnet.
- **None deploy on Base, Ethereum or BNB.**
- Assumable and Mezo Auth Dev were announced but have not submitted.

**Crowded spaces**

| Space | Projects |
|---|---|
| Payments and invoicing (13+) | Liqvera, Remitsheet, MUSD Books, MUSD Subs, MUSD Pay Links, Mezher, two PayLinks, SettleTag, Runway, Pocket, MUSD Pocket, Kudi; prior winners overlap |
| Trove alerts and protection | Vigil, Trove Guardian, Lifeline, Lockwatch, MUSD Pulse, Coil Guard, Pylon Shield; pipeline: Payung, Tripwire; prior winners: BTCShield, AdaptiveGuard, Cermin |
| Leverage and looping | Pylon, two Coils, Mezodot, MezoRoute |
| Escrow | MezoGig, TradeOS, TrustieWork, Wasit |
| Stability Pool / sMUSD wrappers | MUSD Yield Vault, Morbit, Mezo Flow |
| x402, agents and MCP | 6 projects |
| Dashboards | Several read-only dashboards |
| ve wrappers | Lockwatch; existing tools Aurove, Matchbox, Boar; prior winners BynD, Fractals, Mezoir |

**Strongest threats (submitted)**
- **Pylon** (mainnet):
  - Signature-based flash loop, unwind and exit; a redemption-shield reserve; a full redemption-queue radar; a Rust keeper; x402.
  - It ran an AI audit with 35 findings, 32 fixed.
  - Its "102.98M depth" figure is the testnet pool's depth, not mainnet's.
- **mbLP** (testnet):
  - One deposit opens a vault-owned trove, provides BTC/MUSD LP, stakes it in the gauge, and posts part of the fee as a bribe.
  - It has 12 test files including a mainnet fork, an evidence table, and a keeper that runs twice a day.
  - This is the composability template to beat.
- **Mezodot** (testnet hub plus Sepolia spokes): an omnichain money market; large surface and unaudited.
- **Lockwatch** (testnet): guards veBTC/veMEZO lock expiry by re-locking, opening a trove, or depositing to sMUSD. It also claims rewards, rescues loans and sends Telegram alerts. It ships 99 KB of tests.
- **Others:** MezoRoute (capped mainnet executor), Coil (Wilivms), Lifeline, Vigil.

**Pipeline (repos exist, not yet submitted) [RL]**
- **Cosign** (created 2026-10-20): first-loss MUSD cover on unmodified Morpho Blue, where a veBTC vote is capped by the cover posted. Uses MEZO collateral; on testnet. This closely matches Luongo's lending-gauge idea.
- **Thaw:** self-repaying credit against veBTC/veMEZO, plus a bot. Not deployed yet.
- **Latch** (created 2026-10-23): P2P loans against veBTC; one full loan cycle on testnet.
- **Keel:** transferable troves, with strong tests.
- **Payung:** liquidation cover with a pyMUSD 4626 vault.

**Whitespace (no submission so far)**
- MUSD/MEZO products on Base or Ethereum mainnet.
- A correctly integrated 4626 sMUSD used as Morpho collateral.
- A BTC→**MUSD** Morpho market. Cosign uses MEZO as collateral, and Mezodot is a bespoke protocol.
- A USDC bid / exit-liquidity vault for MUSD.
- A B.AMM-style automated Stability Pool.
- Non-custodial automation across all Earn voters.
- Priced boost auctions.
- MEZO-Gauge incentive routing.
- WhatsApp access, a real fiat off-ramp, and SDKs.

**Table stakes:** among the leaders, fork tests against live MUSD, verified source code, tx-hash evidence and AUDIT/SECURITY docs are already standard.

## (f) Judge priorities and red flags

**Who scores**
- Nobody holds the "judge" role yet. The admins with scoring rights are `illshin` (AKINDO founder), `notmartin` (likely the DevRel screener), and two Mezo-only accounts, `duygu_kam` and `civ_defi_mezo`.
- Mezo people close to the program:
  - Andre Coutinho
  - Dymitr Paremski (`dimpar`, contributor to MUSD and the docs)
  - CEO Matt Luongo
  - Engineers Piotr Dyraga, Antonio Salazar Cardozo, Ryan Watts and William Pyke.

**Process**
- **Stage 1 (AKINDO screening):** checks for MUSD/MEZO integration, a working deployment, and all materials (live link, **public** GitHub repo, deck, 2-minute video). Comparable AKINDO programs paid only 7–10 of their 146–186 wave-1 entries.
- **Stage 2 (Mezo core team):** points are proportional and decide payouts. The median top entry takes ≈14% of the pool, and ties are common.
- **Form:** asks for track, chain, readiness and the next three milestones. Wave 2 entries must state what changed.
- **After judging:** per-criterion scores and judge comments become readable through the API.
- **AI review:** AKINDO's AI Review Editor drafts a 0–10 score per criterion; whether Mezo uses it is unconfirmed.
- **After the hackathon:** Ignition grants go up to 25k MEZO and Founder grants up to 50k MEZO. A Mezo Market listing requires a third-party audit and a mainnet deployment.

**Criteria**

| Criterion | Weight | What it covers |
|---|---|---|
| Integration | 30% | "Depth of integration matters more than surface-level usage" |
| Product & Business Viability | 30% | Extends MUSD/MEZO utility; fits the Mezo ecosystem and audience |
| Technical | 20% | Security; "genuinely composable and deployable rather than just a demo" |
| UX | 10% | |
| Materials | 10% | |

- Versus Hackathon 1, Business viability went 20→30 and Technical went 30→20.
- Stated principles: "Extend, don't detour"; "Composability wins" (lending markets, DEXs and vote-escrow beat isolated apps); "Long-term commitment counts".

**Kickoff video** (YouTube `eAiaQpzvVE0`)
- 8:45: "close to a live product on mainnet".
- 9:39: mockups will find it "very hard … to win".
- 1:09:44: judges test the site; engineers check "if the code actually does what the UI tells us"; non-technical testers walk the user journey.
- 1:11:05: "loss of funds" is the fatal mistake.
- 1:18:22: mainnet is "valued more".
- 56:21: AI audits are accepted.
- 1:02:08: an off-ramp that only swaps to USDC "doesn't really do anything".

**Leadership agenda [D]**
- MUSD cross-chain, Base first.
- More vaults and lending markets.
- MEZO utility; Gauges are "the first step".
- A simpler Earn experience.
- Payment rails for AI agents.
- Luongo: "votes for emissions become a signal of creditworthiness". The mechanism post he promised was still unpublished as of the Oct 20 blog [RL].
- Pyke: thin pools put "pressure on the stablecoin's peg".

**Security context**
- Velar was drained: no oracle timestamp checks, no pause, no monitoring.
- An AssetsBridge precompile bug was reported by a whitehat ($50k bounty).
- In July, a Vite build inlined a Cloudflare token into front-end JS, which led to a database leak.
- **On Oct 5, 5.52 BTC was taken from veBTC positions** because the meta-tx sender was dropped across library calls.
- Mezo now reviews code with "frontier AI security models" and is "removing or limiting lesser-used features."

**Red flags**
- Features a judge can't test with faucet funds.
- Mock MUSD.
- Stubs or over-claiming.
- No oracle staleness or deviation guards; no pause or caps; admin keys without a timelock.
- `_msgSender()` / ERC-2771 patterns.
- Secrets in front-end bundles.
- MEZO as collateral at an aggressive LTV.
- Deprecated surfaces.
- Apps that only "accept MUSD".
- Rebuilding existing tools.

**What would impress**
- One flow that composes at least two Mezo primitives on real contracts, with entry, action, a safe exit and an emergency path.
- A composable output token.
- Fork, fuzz and invariant tests, verified source, caps, an AI audit, and an evidence page.
- A business case built on the numbers above.
- A judge can complete every feature in under 5 minutes.

## (g) Proven playbooks that fit Mezo, with forkable code

| Playbook | Evidence elsewhere | Mezo fit [I] | Code (license) |
|---|---|---|---|
| Savings token used as collateral | sUSDS $4.89B; sGHO $233.6M; yBOLD $7.6M (ysyBOLD is collateral on FiRM) | High | OZ/Solady ERC4626 (MIT); MUSDSavingsRate (MIT); Yearn TokenizedStrategy (AGPL) |
| Curated isolated lending | Morpho $11.2B; Steakhouse $2.59B; Felix vaults $32.8M | High (only one Mezo market today) | Morpho Blue, Vault V2 and oracles (GPL-2.0+); AdaptiveCurveIrm (MIT) |
| SP auto-rebalancer (B.AMM) | B.Protocol $0.83M; Liquity v2 routes 75% of interest to SPs | Medium (the SP is idle PCV money) | `mezo-org/thUSD` `B.Protocol/BAMM.sol` and PriceFormula (MIT; same SP interface; the Skip feed is a drop-in) |
| Peg recovery (GHO) | ≈0.965 → $0.9997 through rate hikes, GSM and sGHO | Medium (a minting PSM needs governance) | — |
| veNFT-backed loans (40 Acres) | $3.62M | High but contested (Thaw, Latch) | — |
| CDP automation (DeFi Saver) | $384M | Low (one live trove, ≥9 entrants) | DeFi Saver v3 (MIT) |
| Leverage zaps | Liquity v2 Zappers | Low (thin liquidity; leveraged troves are redeemed first) | Liquity v2 Zappers (MIT) |
| Vote markets / liquid lockers | Hidden Hand wound down; Convex $579M | Low | Paladin (MIT); Velodrome/Relay **BUSL until 2027-01-01** |
| PT/YT tokenization | Pendle $1.06B | Later, on top of a wsMUSD | Pendle v2 (GPL-3.0+) |

**Not forkable:**
- Liquity v2 core (BUSL until 2027-09-01)
- Aave v3.7
- Euler EVK modules
- Uniswap v4-core
- Curve crvUSD
- Velodrome-family code, including Mezo tigris VotingEscrow/Voter (BUSL headers).

**BTCfi lesson:** yield without bridging, plus deep integrations, is what won (Babylon $3.32B, Lombard $604M). Incentive-led L2s failed (Botanix wound down in June 2026). Mezo's own growth came from institutional deals.

## (h) Hard technical constraints

- **Testnet funding.** The faucet gives 0.001 BTC or 100 MEZO per 24h (`wrangler.toml` [RL]). A minimum trove needs ≈0.027 BTC, so swap on the testnet MUSD/BTC pool or ship a prefunded MUSD dispenser.
- **No keepers.**
  - There is no Gelato, no Chainlink Automation, and no 4337 bundler or paymaster.
  - Testnet liquidations and redemptions are idle, so ship your own keeper and keep it permissionless and bounded.
  - Mezo relies on an off-chain poke maintainer.
- **Oracles.** Only BTC/USD is native, and it reverts if staler than 60 s. Everything else must come from Pyth `0x5D28…`/`0x933a…` with your own staleness checks. PREVRANDAO is 0, so there is no on-chain randomness.
- **Troves.**
  - One trove per address; troves cannot be transferred; the last trove cannot close.
  - The capacity lock and Recovery Mode blocks apply.
  - Signatures are ECDSA-only with a single nonce.
  - Contract owners need `receive()`.
- **Accounts.**
  - Passport Safe accounts cannot use MUSD permit or trove signatures.
  - Meta-transactions are disabled.
  - `tx.origin` checks break for smart accounts.
- **sMUSD.**
  - It is not 4626 and pays yield by claims.
  - On testnet there is no PCV or gauge wiring.
  - The owner multisig can upgrade the proxy.
  - Voter payouts are capped, and current payouts are funded from a backlog.
- **Governance-gated (multisig `0x98D8899c3030741925BE630C710A98B57F397C7a`):**
  - token whitelisting
  - vault and third-party gauges
  - managed NFTs
  - new Morpho LLTVs and IRMs
  - MUSD mint-list changes
  - PCV Stability Pool withdrawals
  - rate and fee changes.
- **Permissionless:**
  - Morpho markets (86% LLTV on mainnet, 77% on testnet)
  - pool creation, and pool gauges for whitelisted pairs
  - boost gauges and whitelisted bribes
  - pokes
  - Stability Pool deposits
  - `distributeMUSD`
  - sMUSD yield donations.
- **Liquidity.** Mainnet flash liquidity is ≈1.15 BTC + 15.5k mUSDC. BTC/MUSD has ≈$125k across both sides. Swapping 1,000 MUSD for mUSDC returns 963.6.
- **Precompiles.** At most 20 precompile calls per transaction.
- **DEX ABI.** Slipstream uses tickSpacing, and the Router takes `Route[]`.
- **Chains.** No MUSD on BNB; Base liquidity is moving to Aero; testnet NTT needs a manual redeem.
- **Stale docs to ignore:**
  - the Pyth address
  - the v1 VeBTC/Voter, and testnet `0xB63f…`
  - the MUSD transceivers (live: Mezo `0x62DEeaFEe06c7442A21c93edeDc79A0cb5791C83`, Ethereum `0x147379A0174780570D07d70a14FB244EE5f2D786`)
  - `rpc.mezo.org`
  - the sMUSD "exchange rate"
  - "any ERC-20 bribe" and automatic boost gauges
  - the fixed 90/10 split
  - "1–5% APR"
  - the `address[]` swap path.
- **Calendar.**
  - Wave 1 closes 2026-10-26 15:00 UTC.
  - Enclave A's veBTC #6114 (500 BTC) unlocks on 2026-11-12, in the middle of Wave 2. Its MUSD (5.25M in sMUSD and 5.26M of CL liquidity) dominates both the vault and the main pool.
  - Prizes are paid in MEZO at a 14-day TWAP after KYB.

