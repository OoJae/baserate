import { formatBtc } from '@baserate/sdk'
import { useState } from 'react'
import { BorrowForm, DEFAULT_LTV_BPS, useBorrowQuote } from '../components/borrow/BorrowForm'
import { MarketCard } from '../components/borrow/MarketCard'
import { PositionCard } from '../components/borrow/PositionCard'
import { Checklist } from '../components/Checklist'
import { GetTestFunds } from '../components/GetTestFunds'
import { OraclePanel } from '../components/OraclePanel'
import { RedemptionPanel } from '../components/RedemptionPanel'
import { Notice, PageHeader } from '../components/ui'
import { useMarket } from '../hooks/useMarket'
import { useOracle } from '../hooks/useOracle'
import { usePosition } from '../hooks/usePosition'
import { useWallet } from '../hooks/useWallet'
import { deployed } from '../wagmi'

export function BorrowPage() {
  const wallet = useWallet()
  const oracle = useOracle()
  const market = useMarket()
  const position = usePosition(wallet.address)
  const [btcInput, setBtcInput] = useState('')
  const [ltv, setLtv] = useState(DEFAULT_LTV_BPS)
  const { quote } = useBorrowQuote({ btcInput, ltv, oracle, market, position })

  const compare =
    quote && quote.musdOut > 0n
      ? { collateral: quote.newCollateral, debt: quote.newDebt }
      : { collateral: position.collateral, debt: position.debt }
  const noBtc = wallet.isConnected && wallet.btcBalance === 0n && !position.hasPosition

  return (
    <>
      <PageHeader
        eyebrow="Borrow"
        title="MUSD against your BTC, with no redemption queue"
        lede="Deposit BTC and borrow MUSD in one transaction on Mezo’s own Morpho market. No 2,000-MUSD minimum, no trove queue, and an exit that works even when the oracle is frozen."
      />

      {!deployed.factory ? (
        <Notice tone="brand" className="mb-5" title="Contracts deploy to Mezo testnet next">
          Prices, trove data and previews below are live from Mezo testnet. Borrowing switches on as
          soon as the Baserate contracts are deployed.
        </Notice>
      ) : null}
      {noBtc ? (
        <Notice tone="warn" className="mb-5" title="This wallet has no test BTC yet">
          Take {formatBtc(10n ** 15n)} BTC from the faucet in the “Get test funds” card, then come
          back here.
        </Notice>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-7">
          <PositionCard position={position} oracle={oracle} market={market} wallet={wallet} />
          <BorrowForm
            oracle={oracle}
            market={market}
            wallet={wallet}
            position={position}
            btcInput={btcInput}
            onBtcInput={setBtcInput}
            ltv={ltv}
            onLtv={setLtv}
          />
          <MarketCard market={market} />
        </div>
        <div className="space-y-5 lg:col-span-5">
          <Checklist />
          <OraclePanel oracle={oracle} />
          <RedemptionPanel
            collateral={compare.collateral}
            debt={compare.debt}
            btcUsd={oracle.status?.skipPrice}
            musdUsd={oracle.musdPythRaw}
          />
          <GetTestFunds />
        </div>
      </div>
    </>
  )
}
