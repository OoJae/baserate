import {
  btcMusdOracleAbi,
  type ComputedOracleStatus,
  computeOracleStatus,
  impliedMusdLeg,
  multicall3Abi,
  type OracleStatus,
  pythAbi,
  SKIP_BTC_USD,
  skipAggregatorAbi,
  statusReason,
} from '@baserate/sdk'
import { useReadContract, useReadContracts } from 'wagmi'
import { appChain, deployed, registry } from '../wagmi'

export interface OracleView {
  /** The verdict used for previews: BtcMusdOracle.status() when deployed, else the client-side mirror. */
  status: OracleStatus | undefined
  source: 'contract' | 'mirror'
  reason: ComputedOracleStatus['reason'] | undefined
  /** Raw Pyth MUSD/USD (1e18) and the MUSD/USD leg actually used for the price. */
  musdPythRaw: bigint | undefined
  musdUsed: bigint | undefined
  /** react-query timestamp of the read, so ages can tick client-side. */
  updatedAt: number
  isLoading: boolean
  isError: boolean
}

/**
 * Oracle state. Reads Skip + Pyth directly (1 precompile call) for the raw feeds, and BtcMusdOracle.status()
 * (1 more) once deployed. Both multicalls stay far below Mezo's 20-precompile-calls limit.
 */
export function useOracle(): OracleView {
  const feeds = useReadContracts({
    contracts: [
      { address: SKIP_BTC_USD, abi: skipAggregatorAbi, functionName: 'latestRoundData' },
      {
        address: registry.external.pyth,
        abi: pythAbi,
        functionName: 'getPriceUnsafe',
        args: [registry.feeds.pythBtcUsd],
      },
      {
        address: registry.external.pyth,
        abi: pythAbi,
        functionName: 'getPriceUnsafe',
        args: [registry.feeds.pythMusdUsd],
      },
      {
        address: registry.external.multicall3,
        abi: multicall3Abi,
        functionName: 'getCurrentBlockTimestamp',
      },
    ],
    allowFailure: true,
    query: { refetchInterval: 10_000 },
  })

  const onchain = useReadContract({
    address: registry.contracts.oracle.address,
    abi: btcMusdOracleAbi,
    functionName: 'status',
    chainId: appChain.id,
    query: { enabled: deployed.oracle, refetchInterval: 10_000 },
  })

  let mirror: ComputedOracleStatus | undefined
  if (feeds.data) {
    const [skip, btc, musd, ts] = feeds.data
    const now = ts?.status === 'success' ? ts.result : BigInt(Math.floor(Date.now() / 1000))
    mirror = computeOracleStatus({
      now,
      skip:
        skip?.status === 'success' ? { answer: skip.result[1], updatedAt: skip.result[3] } : null,
      pythBtc:
        btc?.status === 'success'
          ? { price: btc.result.price, expo: btc.result.expo, publishTime: btc.result.publishTime }
          : null,
      pythMusd:
        musd?.status === 'success'
          ? {
              price: musd.result.price,
              expo: musd.result.expo,
              publishTime: musd.result.publishTime,
            }
          : null,
    })
  }

  if (deployed.oracle) {
    const status = onchain.data
    return {
      status,
      source: 'contract',
      reason: status ? statusReason(status) : undefined,
      musdPythRaw: mirror?.musdPythRaw,
      musdUsed: status ? (impliedMusdLeg(status) ?? undefined) : undefined,
      updatedAt: onchain.dataUpdatedAt,
      isLoading: onchain.isLoading,
      isError: onchain.isError,
    }
  }

  return {
    status: mirror,
    source: 'mirror',
    reason: mirror?.reason,
    musdPythRaw: mirror?.musdPythRaw,
    musdUsed: mirror?.musdUsed,
    updatedAt: feeds.dataUpdatedAt,
    isLoading: feeds.isLoading,
    isError: feeds.isError,
  }
}
