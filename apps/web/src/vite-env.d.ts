/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Reown (WalletConnect) project id. Optional: without it the app offers injected wallets only. */
  readonly BASERATE_PUBLIC_WC_PROJECT_ID?: string
  /** Set to "1" to target a local anvil fork of testnet (chain id 31337) instead of Mezo testnet. */
  readonly BASERATE_PUBLIC_LOCAL_FORK?: string
  /** Keeper status API base URL. Defaults to the Railway deployment. */
  readonly BASERATE_PUBLIC_KEEPER_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
