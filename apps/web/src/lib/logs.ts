import { minBig } from '@baserate/sdk'
import {
  type Abi,
  type Address,
  type ContractEventName,
  type GetContractEventsReturnType,
  type Log,
  type PublicClient,
  parseEventLogs,
} from 'viem'

/** Mezo RPCs serve eth_getLogs over at most 10,000 blocks. */
export const LOG_RANGE = 9_999n

/**
 * `getContractEvents` over any block range, in ≤10,000-block windows read three at a time, oldest first.
 * With a subgraph configured (lib/subgraph.ts) history hooks only use this for the blocks it has not indexed yet,
 * or for everything when it is unavailable.
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
  const out = await inWindows(client, params.fromBlock, params.toBlock, (fromBlock, toBlock) =>
    client.getContractEvents({
      address: params.address,
      abi: params.abi,
      eventName: params.eventName,
      args: params.args,
      fromBlock,
      toBlock,
    } as never),
  )
  return out as GetContractEventsReturnType<abi, eventName>
}

/**
 * Every event `address` emitted, in one log scan, decoded with `abi` (logs it does not describe are dropped), oldest
 * first. One scan instead of one per event name when a reader needs several events of the same contract.
 */
export async function getAllEventsChunked<const abi extends Abi>(
  client: PublicClient,
  params: { address: Address; abi: abi; fromBlock: bigint; toBlock?: bigint },
) {
  const logs = await inWindows(client, params.fromBlock, params.toBlock, (fromBlock, toBlock) =>
    client.getLogs({ address: params.address, fromBlock, toBlock }),
  )
  return parseEventLogs({ abi: params.abi, logs: logs as Log[] })
}

/** Runs `read` over [fromBlock, toBlock ?? head] in ≤10,000-block windows, three at a time, oldest first. */
async function inWindows(
  client: PublicClient,
  fromBlock: bigint,
  toBlock: bigint | undefined,
  read: (from: bigint, to: bigint) => Promise<unknown>,
): Promise<unknown[]> {
  const end = toBlock ?? (await client.getBlockNumber())
  const windows: [bigint, bigint][] = []
  for (let from = fromBlock; from <= end; from += LOG_RANGE + 1n) {
    windows.push([from, minBig(from + LOG_RANGE, end)])
  }
  const out: unknown[] = []
  for (let i = 0; i < windows.length; i += 3) {
    const batch = await Promise.all(windows.slice(i, i + 3).map(([from, to]) => read(from, to)))
    for (const logs of batch) out.push(...(logs as unknown[]))
  }
  return out
}
