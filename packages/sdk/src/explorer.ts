import { MEZO_MAINNET_ID, MEZO_TESTNET_ID } from './chains'

/** Blockscout explorers. Their v2 REST APIs serve decoded transactions and logs with CORS `*`. */
const EXPLORERS: Record<number, { ui: string; api: string }> = {
  [MEZO_TESTNET_ID]: {
    ui: 'https://explorer.test.mezo.org',
    api: 'https://api.explorer.test.mezo.org/api/v2',
  },
  [MEZO_MAINNET_ID]: {
    ui: 'https://explorer.mezo.org',
    api: 'https://api.explorer.mezo.org/api/v2',
  },
}

/** Local forks have no explorer; links fall back to testnet's. */
function explorerFor(chainId: number) {
  return EXPLORERS[chainId] ?? (EXPLORERS[MEZO_TESTNET_ID] as { ui: string; api: string })
}

export function explorerTxUrl(chainId: number, hash: string): string {
  return `${explorerFor(chainId).ui}/tx/${hash}`
}

export function explorerAddressUrl(chainId: number, address: string): string {
  return `${explorerFor(chainId).ui}/address/${address}`
}

export function explorerBlockUrl(chainId: number, block: number | bigint): string {
  return `${explorerFor(chainId).ui}/block/${block}`
}

/** Blockscout REST API base, e.g. https://api.explorer.test.mezo.org/api/v2 */
export function blockscoutApi(chainId: number): string {
  return explorerFor(chainId).api
}

export function hasExplorer(chainId: number): boolean {
  return chainId in EXPLORERS
}
