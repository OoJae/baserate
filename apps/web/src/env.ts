/**
 * Public, build-time configuration. Only BASERATE_PUBLIC_* variables exist in the bundle (vite envPrefix);
 * nothing here may ever be a secret.
 */

function clean(value: string | undefined): string | undefined {
  const v = value?.trim()
  return v ? v : undefined
}

export const env = {
  /** Reown / WalletConnect project id (optional). */
  walletConnectProjectId: clean(import.meta.env.BASERATE_PUBLIC_WC_PROJECT_ID),
  /** Target a local anvil fork (chain 31337) instead of Mezo testnet. */
  localFork: clean(import.meta.env.BASERATE_PUBLIC_LOCAL_FORK) === '1',
  /** Base URL of the keeper's public status API (apps/keeper on Railway). */
  keeperUrl:
    clean(import.meta.env.BASERATE_PUBLIC_KEEPER_URL) ??
    'https://keeper-production-be8a.up.railway.app',
} as const
