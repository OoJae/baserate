import { minBig } from '@baserate/sdk'
import type {
  Abi,
  Address,
  ContractEventName,
  GetContractEventsReturnType,
  PublicClient,
} from 'viem'

/** Mezo RPCs serve eth_getLogs over at most 10,000 blocks. */
export const LOG_RANGE = 9_999n

/**
 * `getContractEvents` over any block range, in ≤10,000-block windows read three at a time, oldest first.
 * Baserate contracts are young, so this is a handful of requests; an indexer replaces it in a later release.
 */
export async function getEventsChunked<
  const abi extends Abi,
  eventName extends ContractEventName<abi>,
>(
  client: PublicClient,
  params: {
    address: Address
    abi: abi
    eventName: eventName
    args?: Record<string, unknown>
    fromBlock: bigint
    toBlock?: bigint
  },
): Promise<GetContractEventsReturnType<abi, eventName>> {
  const toBlock = params.toBlock ?? (await client.getBlockNumber())
  const windows: [bigint, bigint][] = []
  for (let from = params.fromBlock; from <= toBlock; from += LOG_RANGE + 1n) {
    const to = minBig(from + LOG_RANGE, toBlock)
    windows.push([from, to])
  }
  const out: unknown[] = []
  for (let i = 0; i < windows.length; i += 3) {
    const batch = await Promise.all(
      windows.slice(i, i + 3).map(([fromBlock, to]) =>
        client.getContractEvents({
          address: params.address,
          abi: params.abi,
          eventName: params.eventName,
          args: params.args,
          fromBlock,
          toBlock: to,
        } as never),
      ),
    )
    for (const logs of batch) out.push(...(logs as unknown[]))
  }
  return out as GetContractEventsReturnType<abi, eventName>
}
