import registry from '@baserate/sdk/deployments/31611.json'
import { Link } from '@tanstack/react-router'
import type { CSSProperties } from 'react'
import { APP_CHAIN_ID } from '../../queryClient'
import { Medallion, rateLinePath, useWide } from '../parts/engraving'
import {
  EpochBar,
  FeeSplit,
  LoanSequence,
  LtvGauge,
  PriceAges,
  RateSheet,
  VaultSplit,
} from '../parts/how/diagrams'
import { KeeperLive } from '../parts/how/KeeperLive'
import { Band, Cta, Ctas, Masthead, OnThisPage, Plate, Serial, SitePage } from '../parts/layout'
import { repoFile } from '../parts/links'

/*
 * /how-it-works: the mechanism in plain words, one plate per part. Every number is a contract constant, a deploy
 * parameter (contracts/script/Deploy.s.sol, testnet) or the testnet registry (packages/sdk deployments), and each
 * figure names its source. Facts follow docs/design/contracts.md and docs/SECURITY.md.
 */

/** M1's liquidation LTV from the testnet registry, in basis points (0.77e18 → 7700). */
const LLTV_BPS = Number(BigInt(registry.lltv) / 10n ** 14n)
/** Testnet limits as deployed (Deploy.s.sol): STANDARD and CANARY ceilings, caps. */
const STANDARD_CEILING_BPS = 6200
const CANARY_CEILING_BPS = 7675
const pctOf = (bps: number) => `${bps % 100 === 0 ? bps / 100 : (bps / 100).toFixed(2)}%`

const SECTIONS = [
  { id: 'loan', label: 'The loan' },
  { id: 'price', label: 'The price' },
  { id: 'lenders', label: 'The lenders' },
  { id: 'liquidations', label: 'Liquidations' },
  { id: 'fees', label: 'Fees' },
] as const

function PlateFigure() {
  const wide = useWide()
  // The base-rate line, flat, rise, flat over its base, centred in the plate's clear field.
  const { line, base } = rateLinePath(392, 446, 216)
  const late = { '--i': 34 } as CSSProperties
  return (
    <Medallion
      wide={wide}
      spec={{ petals: 26, lines: 16, twist: 0.18 }}
      centre={
        <g fill="none" stroke="var(--ink)" strokeWidth={wide ? 7 : 10}>
          <path d={base} pathLength={1} className="sp-draw" style={late} />
          <path
            d={line}
            pathLength={1}
            className="sp-draw"
            style={{ '--i': 38 } as CSSProperties}
          />
        </g>
      }
    />
  )
}

export function HowItWorksPage() {
  const network = APP_CHAIN_ID === 31_611 ? 'Mezo testnet' : 'Local fork'
  return (
    <SitePage>
      <Masthead
        label="How it works"
        meta={
          <>
            {network} · chain {APP_CHAIN_ID} · M1 LLTV {pctOf(LLTV_BPS)}
          </>
        }
        lines={['Five parts. ', 'One loan you can ', <em key="close">always close.</em>]}
        lead={
          <>
            You lock BTC in an account only you control, borrow MUSD from Mezo’s own Morpho market,
            and repay when you choose. No redemption queue can take your bitcoin. Here is each part,
            with the limits the contracts enforce on Mezo testnet.
          </>
        }
        figure={<PlateFigure />}
      />
      <OnThisPage items={SECTIONS} />

      <Plate
        id="loan"
        ground="paper"
        label="The loan"
        source="BorrowAccountFactory · CollateralBTC · Morpho M1"
        title={
          <>
            Your own account, <em>Mezo’s own</em> market
          </>
        }
        intro={
          <p className="sp-lead">
            One transaction opens your account, posts your BTC and borrows MUSD. Each borrower gets
            their own BorrowAccount, and only its owner can act on it.
          </p>
        }
      >
        <div className="sp-stack">
          <LoanSequence
            steps={[
              {
                kind: 'btc',
                title: 'Send BTC',
                body: (
                  <>
                    You call <code className="sp-code">openAndBorrow</code> with BTC as the
                    transaction’s value. The factory deploys your BorrowAccount at an address fixed
                    by your wallet. It has no initializer, so nobody can set it up before you.
                  </>
                ),
              },
              {
                kind: 'receipt',
                title: 'Wrap it 1:1',
                body: (
                  <>
                    Your account wraps the BTC into bcBTC, a receipt only registered accounts can
                    mint. It can only move from an account into Morpho and back out, so all M1
                    collateral sits under Baserate’s caps.
                  </>
                ),
              },
              {
                kind: 'market',
                title: 'Borrow from M1',
                body: (
                  <>
                    The account posts the bcBTC to M1, the MUSD market on Mezo’s Morpho Blue, and
                    borrows. The borrow reverts unless it stays inside your LTV limit, the position
                    cap and the global cap.
                  </>
                ),
              },
              {
                kind: 'musd',
                title: 'Get MUSD',
                body: (
                  <>
                    The MUSD goes to your wallet, and the 0.10% origination fee is added to your
                    debt. The account ends every call holding no MUSD and no bcBTC.
                  </>
                ),
              },
            ]}
            exit={
              <>
                <code className="sp-code">repayAndWithdraw</code> pays back the exact debt and sends
                your BTC home in one transaction. It never reads the price, so it works even when
                the oracle is down.
              </>
            }
          />

          <div className="sp-split sp-split--even">
            <div>
              <h3 className="sp-h3">Limits on testnet</h3>
              <p className="sp-small sp-gap-sm">
                Cuts take effect at once. Raises wait out a 48-hour public timelock.
              </p>
              <RateSheet
                rows={[
                  {
                    id: 'lltv',
                    label: 'Liquidation line (LLTV)',
                    value: `${pctOf(LLTV_BPS)} LTV`,
                  },
                  {
                    id: 'ceiling',
                    label: 'Most you can borrow',
                    value: `${pctOf(STANDARD_CEILING_BPS)} LTV`,
                  },
                  {
                    id: 'position',
                    label: 'Position cap',
                    value: '0.01 BTC',
                    note: 'Stops new borrowing on a bigger position. Adding collateral is never capped.',
                  },
                  { id: 'global', label: 'Cap on all M1 borrowing', value: '5,000 MUSD' },
                  { id: 'fee', label: 'Origination fee', value: '0.10%' },
                ]}
                caption="As deployed · contracts/script/Deploy.s.sol · registry 31611"
              />
            </div>
            <div className="sp-why">
              <h3 className="sp-h3">Why there is no redemption queue</h3>
              <div className="sp-prose sp-gap-sm">
                <p>
                  A MUSD trove can be redeemed: while MUSD trades under its floor, anyone can swap
                  MUSD for the BTC of the lowest-ratio troves. Baserate’s collateral sits in Morpho,
                  which has no redemption at all. Your position closes when you repay it, or if it
                  crosses the liquidation line.
                </p>
              </div>
              <dl className="sp-figures sp-why__figures" style={{ '--cols': 2 } as CSSProperties}>
                <div>
                  <dt>Open MUSD troves, 30 Nov 2025 to 23 Oct 2026</dt>
                  <dd className="sp-numeral">
                    <span aria-hidden>104 → 1</span>
                    <span className="sp-sr">104 to 1</span>
                  </dd>
                </div>
                <div>
                  <dt>MUSD, under the ≈$0.9925 redemption floor</dt>
                  <dd className="sp-numeral">$0.989</dd>
                </div>
                <div>
                  <dt>MUSD redeemed in 30 days</dt>
                  <dd className="sp-numeral">1.28M</dd>
                </div>
                <div>
                  <dt>MUSD lent on Mezo’s Morpho before M1</dt>
                  <dd className="sp-numeral">0</dd>
                </div>
              </dl>
              <Serial className="sp-source">
                Mezo mainnet · read 23–24 Oct 2026 · docs/research/brief.md §0
              </Serial>
            </div>
          </div>
          <Ctas>
            <Cta to="/borrow" variant="solid">
              Borrow on testnet
            </Cta>
          </Ctas>
        </div>
      </Plate>

      <Plate
        id="price"
        label="The price"
        source="BtcMusdOracle · immutable"
        title={
          <>
            A price must pass <em>three checks</em>
          </>
        }
        intro={
          <p className="sp-lead">
            The oracle gives Morpho one number: the BTC price in MUSD. It comes from Mezo’s own
            price feed, is checked against a second source, and never comes from a trading pool,
            where one trade can move it.
          </p>
        }
      >
        <div className="sp-stack">
          <PriceAges
            rows={[
              {
                name: 'Skip BTC/USD',
                rule: 'Mezo’s built-in price feed: the price itself.',
                limit: 60,
                limitLabel: '60 s',
                after: 'the read reverts',
              },
              {
                name: 'Pyth BTC/USD band',
                rule: 'While fresh, Skip must sit within 10% of it.',
                limit: 600,
                limitLabel: '600 s',
                after: 'the band is off',
              },
              {
                name: 'Pyth MUSD/USD',
                rule: 'The dollar leg, clamped to 1.00–1.02.',
                limit: 3900,
                limitLabel: '3,900 s',
                after: 'MUSD counts as 1.00',
              },
            ]}
          />
          <div className="sp-split">
            <div>
              <p className="sp-formula">
                <span className="sp-serial">Price</span>
                <span className="sp-formula__eq">BTC in MUSD = Skip BTC/USD ÷ MUSD/USD</span>
              </p>
              <div className="sp-prose sp-gap">
                <p>
                  The dollar leg can only make your collateral look smaller, never bigger. With MUSD
                  at ≈$0.989 (mainnet, 23–24 Oct 2026), the clamp values it about 1.1% under the
                  market, so it can only bring a liquidation slightly earlier, never later.
                </p>
              </div>
            </div>
            <div className="sp-outcomes">
              <h3 className="sp-h3">If the price cannot be read</h3>
              <div className="sp-outcomes__cols">
                <div>
                  <Serial>Waits</Serial>
                  <ul className="sp-list sp-prose sp-gap-sm">
                    <li>Borrowing more</li>
                    <li>Withdrawing BTC while you owe MUSD</li>
                    <li>Liquidations</li>
                  </ul>
                </div>
                <div>
                  <Serial>Keeps working</Serial>
                  <ul className="sp-list sp-prose sp-gap-sm">
                    <li>Adding collateral</li>
                    <li>Repaying</li>
                    <li>Repay and exit, which reads no price</li>
                  </ul>
                </div>
              </div>
              <p className="sp-small sp-gap">
                A Skip outage has no time limit, and we say so. A disagreement with a lagging Pyth
                ends within 10 minutes, when the band switches off. Round 3 of the review found how
                genuine but lagged Pyth prints can stretch that in a fast crash:{' '}
                <Link className="sp-link" to="/security" hash="findings">
                  see the ledger
                </Link>
                .
              </p>
            </div>
          </div>
          <Ctas>
            <Cta to="/risk">See the oracle live in RiskLens</Cta>
          </Ctas>
        </div>
      </Plate>

      <Plate
        id="lenders"
        ground="paper"
        label="The lenders"
        source="vMUSD · BaserateAllocator · WsMUSD"
        title={
          <>
            vMUSD lends to borrowers and <em>parks the rest</em>
          </>
        }
        intro={
          <p className="sp-lead">
            Deposit MUSD in vMUSD, a Morpho Vault V2. Your MUSD is either lent to BTC borrowers in
            M1 or held in wsMUSD, earning the sMUSD savings rate. A permissionless allocator moves
            it between the two.
          </p>
        }
      >
        <div className="sp-stack">
          <VaultSplit
            m1={
              <p>Lent to BTC borrowers through MorphoMarketV1AdapterV2, earning the borrow rate.</p>
            }
            idle={
              <p>
                Part of M1 always stays unborrowed, so lenders can leave: at least 2,000 MUSD or 15%
                of M1’s supply, whichever is larger.
              </p>
            }
            ws={
              <p>
                Held in wsMUSD through the WsMusdLiquidityAdapter, earning the savings rate. New
                deposits land here first.
              </p>
            }
            allocator={
              <p>
                <span className="sp-h4">BaserateAllocator</span> moves at most 1,000 MUSD a time
                between M1 and wsMUSD, inside the vault’s caps. When the idle part runs low it tops
                it back up without waiting for its cooldown.
              </p>
            }
          />
          <div className="sp-split sp-split--even">
            <div>
              <h3 className="sp-h3">How the allocator decides</h3>
              <ul className="sp-list sp-prose sp-gap">
                <li>
                  <strong>Direction</strong> comes from 7-day trailing realized APYs: M1’s share
                  price against wsMUSD’s. No single transaction can move them.
                </li>
                <li>
                  <strong>No same-block moves.</strong> If M1 was touched earlier in the block, it
                  makes no rate-driven move, so a flash supply or borrow cannot steer it.
                </li>
                <li>
                  <strong>Small steps.</strong> At most 1,000 MUSD per move, with an hour between
                  rate-driven moves. Buffer top-ups skip the wait, once per block.
                </li>
                <li>
                  <strong>Anyone can run it.</strong> <code className="sp-code">rebalance()</code>{' '}
                  is permissionless; the keeper calls it every 15 minutes.
                </li>
              </ul>
            </div>
            <div>
              <h3 className="sp-h3">When you withdraw</h3>
              <ul className="sp-list sp-prose sp-gap">
                <li>Idle MUSD and wsMUSD pay first; only the shortfall comes out of M1.</li>
                <li>
                  If the wsMUSD leg cannot pay, the withdrawal retries from M1 first, so the part
                  lent in M1 always gets out.
                </li>
                <li>
                  wsMUSD vests harvested yield over 3 days, so nothing that lands in a single block
                  moves its share price.
                </li>
              </ul>
            </div>
          </div>
          <Ctas>
            <Cta to="/lend" variant="solid">
              Lend through vMUSD
            </Cta>
            <Cta to="/save">Save in wsMUSD</Cta>
          </Ctas>
        </div>
      </Plate>

      <Plate
        id="liquidations"
        label="Liquidations"
        source="FlashLiquidator · Backstop · keeper"
        title={
          <>
            Liquidations need <em>no capital</em> and no permission
          </>
        }
        intro={
          <p className="sp-lead">
            Past {pctOf(LLTV_BPS)} LTV, anyone can liquidate a position. The FlashLiquidator lets
            them do it with nothing but gas: the seized BTC pays for itself.
          </p>
        }
      >
        <div className="sp-stack">
          <LtvGauge
            ceilingBps={STANDARD_CEILING_BPS}
            canaryBps={CANARY_CEILING_BPS}
            lltvBps={LLTV_BPS}
          />
          <div className="sp-split">
            <div>
              <h3 className="sp-h3">One transaction, no capital</h3>
              <ol className="sp-chain sp-gap">
                <li>Morpho seizes the position’s bcBTC and hands it to the FlashLiquidator.</li>
                <li>It unwraps the bcBTC to BTC and sells it on the chosen venue.</li>
                <li>
                  The sale must clear the oracle price, less the venue’s allowed impact, or it all
                  reverts.
                </li>
                <li>Morpho takes back the MUSD it is owed; the rest goes to the caller.</li>
              </ol>
              <p className="sp-small sp-gap">
                At a {pctOf(LLTV_BPS)} LLTV, Morpho’s liquidation incentive is 7.41%.
              </p>
            </div>
            <div>
              <h3 className="sp-h3">Three venues</h3>
              <table className="sp-table sp-gap">
                <caption className="sp-sr">Liquidation venues and their precompile calls</caption>
                <thead>
                  <tr>
                    <th scope="col">Venue</th>
                    <th scope="col">How it buys</th>
                    <th scope="col" className="sp-table__num">
                      Precompile calls
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Backstop</th>
                    <td>Its MUSD pool pays the oracle price less half the incentive</td>
                    <td className="sp-table__num">3 of 20</td>
                  </tr>
                  <tr>
                    <th scope="row">Tigris CL200</th>
                    <td>Concentrated-liquidity BTC/MUSD pool</td>
                    <td className="sp-table__num">6 of 20</td>
                  </tr>
                  <tr>
                    <th scope="row">Tigris vAMM</th>
                    <td>Volatile BTC/MUSD pool</td>
                    <td className="sp-table__num">7 of 20</td>
                  </tr>
                </tbody>
              </table>
              <Serial className="sp-source">
                Mezo allows 20 precompile calls per transaction · FlashLiquidator.sol NatSpec
              </Serial>
            </div>
          </div>
          <div className="sp-split sp-split--even">
            <div>
              <h3 className="sp-h3">The backstop</h3>
              <ul className="sp-list sp-prose sp-gap">
                <li>Holds bought BTC at 0.95 of the oracle price.</li>
                <li>
                  Sells it in a 6-hour Dutch auction, from 1.00 down to 0.95 of the Skip price.
                </li>
                <li>Gains vest over 7 days; losses count at once.</li>
                <li>
                  Exits wait 7 days and pay the lower of the value when you asked and when you
                  claim.
                </li>
                <li>
                  Deposits close while it holds BTC, so nobody can buy in between a purchase and its
                  sale.
                </li>
              </ul>
            </div>
            <div>
              <h3 className="sp-h3">The keeper and the canary</h3>
              <div className="sp-prose sp-gap">
                <p>
                  A public keeper scans every 12 seconds and liquidates any position past the line,
                  trying the vAMM first, then the backstop.
                </p>
                <p>
                  The canary is a real position the keeper keeps at {pctOf(CANARY_CEILING_BPS)} LTV,
                  a quarter point under the line, so anyone can try a live liquidation on testnet.
                  When it crosses, the keeper leaves it to the public for 6 hours, or until its
                  health falls below 0.98, and then takes it. A new canary opens 30 minutes later.
                </p>
              </div>
              <KeeperLive />
            </div>
          </div>
          <Ctas>
            <Cta to="/liquidate" variant="solid">
              Liquidate on testnet
            </Cta>
            <Cta to="/evidence">See the keeper’s status</Cta>
          </Ctas>
        </div>
      </Plate>

      <Plate
        id="fees"
        ground="paper"
        label="Fees"
        source="FeeRouter · immutable, no owner"
        title={
          <>
            One fee, <em>split three ways</em>
          </>
        }
        intro={
          <p className="sp-lead">
            Every borrow pays a 0.10% origination fee. The FeeRouter, a contract with no owner,
            splits it so borrowers’ fees flow back into Mezo.
          </p>
        }
      >
        <div className="sp-stack">
          <FeeSplit
            legs={[
              {
                share: 0.4,
                name: 'sMUSD holders',
                body: 'Paid in as yield, through sMUSD’s own receiveProtocolYield.',
                gap: 3,
                angle: -45,
              },
              {
                share: 0.4,
                name: 'veBTC voters',
                body: 'MUSD bribes on the BTC/MUSD pool gauges, split equally between them.',
                gap: 4.5,
                angle: 45,
              },
              {
                share: 0.2,
                name: 'The treasury',
                body: 'Paid every time, whatever the other legs do.',
                gap: 7,
                angle: 0,
              },
            ]}
          />
          <div className="sp-split">
            <div>
              <h3 className="sp-h3">Why bribe the pool gauges</h3>
              <div className="sp-prose sp-gap">
                <p>
                  veBTC holders vote each week on which pools get MEZO emissions. More emissions on
                  the BTC/MUSD pools mean deeper liquidity, and deeper liquidity is what lets a
                  liquidation sell seized BTC cleanly. Borrowers’ fees buy the depth that keeps
                  their market safe.
                </p>
              </div>
            </div>
            <div>
              <EpochBar
                flushAt="The keeper calls distribute() once an epoch, from Thursday 01:05 UTC. Anyone else can call it too."
                cutoff="In the last hour, Mezo’s voter accepts only whitelisted veNFTs, so no bribe goes out: that share waits for the next."
              />
            </div>
          </div>
          <div>
            <h3 className="sp-h3">When a leg cannot pay</h3>
            <ul className="sp-list sp-prose sp-gap sp-columns">
              <li>
                A gauge whose bribe has no votes gets nothing yet: its share is carried and added to
                the same gauge’s next bribe.
              </li>
              <li>A gauge Mezo has killed gets no bribe; its share goes to sMUSD instead.</li>
              <li>
                sMUSD is never trusted to succeed. If its share keeps failing across two epoch
                flips, it goes to the treasury until one donation works.
              </li>
              <li>The factory’s fee recipient can only change through the 48-hour timelock.</li>
            </ul>
          </div>
          <Ctas>
            <Cta to="/fees" variant="solid">
              See the next distribution
            </Cta>
          </Ctas>
        </div>
      </Plate>

      <Plate
        id="check"
        label="Check it"
        source="docs/design/contracts.md · docs/SECURITY.md"
        title={
          <>
            Read the contracts, then <em>check the chain</em>
          </>
        }
      >
        <div className="sp-split sp-split--wide-text">
          <div className="sp-prose">
            <p>
              Every claim on this page is in the contracts, and every contract is verified on Mezo
              testnet. The Evidence page re-checks each transaction behind the demo against the
              explorer while you watch.
            </p>
            <p>
              The full specification is{' '}
              <a className="sp-link" href={repoFile('docs/design/contracts.md')}>
                docs/design/contracts.md
              </a>
              , and what can go wrong, and what we have not solved, is in{' '}
              <a className="sp-link" href={repoFile('docs/SECURITY.md')}>
                docs/SECURITY.md
              </a>
              .
            </p>
          </div>
          <Ctas>
            <Cta to="/evidence" variant="solid">
              Check the chain
            </Cta>
            <Cta to="/security">Read the security review</Cta>
          </Ctas>
        </div>
      </Plate>
      <Band className="sp-end-band" />
    </SitePage>
  )
}
