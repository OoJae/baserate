import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import {
  borrowAccountAbi,
  borrowAccountFactoryAbi,
  erc20PermitAbi,
  getRegistry,
  musdDispenserAbi,
  Profile,
  wsMusdAbi,
} from '@baserate/sdk'
import type { Address, Hex, PublicClient, TransactionReceipt } from 'viem'

const run = promisify(execFile)

/**
 * Reads the journey's on-chain state straight from the RPC, independent of the UI. When Foundry's `cast` is on
 * PATH, settled snapshots are read a second time with `cast` at the same block and the two must agree, so a bug
 * in the app's own viem/wagmi stack cannot hide behind a matching harness read.
 */

export interface Snapshot {
  block: bigint
  btc: bigint
  musd: bigint
  wsMusd: bigint
  smusd: bigint
  account: Address
  accountDeployed: boolean
  collateral: bigint
  debt: bigint
  dispenserClaimable: bigint
}

export class Chain {
  readonly registry = getRegistry(31611)
  private readonly castBin: string | null
  /** Every cast invocation and its output, for the journey log. */
  readonly castLog: { cmd: string; out: string }[] = []

  constructor(
    readonly client: PublicClient,
    readonly rpcUrl: string,
  ) {
    this.castBin = findCast()
  }

  get hasCast(): boolean {
    return this.castBin !== null
  }

  /** State at the latest block; `crossCheck` re-reads it with cast (skip it inside polling loops). */
  async snapshot(owner: Address, { crossCheck = true } = {}): Promise<Snapshot> {
    const r = this.registry
    const c = this.client
    const block = await c.getBlockNumber({ cacheTime: 0 })
    const at = { blockNumber: block }
    const [account, accountDeployed] = await c.readContract({
      address: r.contracts.factory.address,
      abi: borrowAccountFactoryAbi,
      functionName: 'accountOf',
      args: [owner, Profile.STANDARD],
      ...at,
    })
    const erc20 = (token: Address, who: Address) =>
      c.readContract({
        address: token,
        abi: erc20PermitAbi,
        functionName: 'balanceOf',
        args: [who],
        ...at,
      })
    const [btc, musd, wsMusd, smusd, dispenserClaimable, position] = await Promise.all([
      c.getBalance({ address: owner, ...at }),
      erc20(r.external.musd, owner),
      c.readContract({
        address: r.contracts.wsMusd.address,
        abi: wsMusdAbi,
        functionName: 'balanceOf',
        args: [owner],
        ...at,
      }),
      erc20(r.external.smusd, owner),
      c.readContract({
        address: r.contracts.dispenser.address,
        abi: musdDispenserAbi,
        functionName: 'claimable',
        args: [owner],
        ...at,
      }),
      accountDeployed
        ? Promise.all([
            c.readContract({
              address: account,
              abi: borrowAccountAbi,
              functionName: 'collateral',
              ...at,
            }),
            c.readContract({
              address: account,
              abi: borrowAccountAbi,
              functionName: 'debt',
              ...at,
            }),
          ])
        : Promise.resolve([0n, 0n] as const),
    ])
    const snap: Snapshot = {
      block,
      btc,
      musd,
      wsMusd,
      smusd,
      account,
      accountDeployed,
      collateral: position[0],
      debt: position[1],
      dispenserClaimable,
    }
    if (crossCheck && this.castBin) await this.crossCheck(owner, snap)
    return snap
  }

  /** Re-reads the snapshot with `cast` at the same block and throws on any disagreement. */
  private async crossCheck(owner: Address, s: Snapshot) {
    const r = this.registry
    const b = s.block.toString()
    const call = (to: Address, sig: string, ...args: string[]) =>
      this.cast(['call', to, sig, ...args, '--block', b])
    const checks: [string, bigint, Promise<string>][] = [
      ['btc', s.btc, this.cast(['balance', owner, '--block', b])],
      ['musd', s.musd, call(r.external.musd, 'balanceOf(address)(uint256)', owner)],
      ['wsMusd', s.wsMusd, call(r.contracts.wsMusd.address, 'balanceOf(address)(uint256)', owner)],
      ['smusd', s.smusd, call(r.external.smusd, 'balanceOf(address)(uint256)', owner)],
    ]
    if (s.accountDeployed) {
      checks.push(['collateral', s.collateral, call(s.account, 'collateral()(uint256)')])
      checks.push(['debt', s.debt, call(s.account, 'debt()(uint256)')])
    }
    const outs = await Promise.all(checks.map(([, , out]) => out))
    checks.forEach(([name, viemValue], i) => {
      const castValue = BigInt(outs[i]?.split(/\s+/)[0] ?? 'NaN')
      if (castValue !== viemValue)
        throw new Error(
          `cast and viem disagree on ${name} at block ${b}: ${castValue} vs ${viemValue}`,
        )
    })
  }

  /** `cast receipt <hash> status` for the log, or null without cast. */
  async castReceipt(hash: Hex): Promise<string | null> {
    if (!this.castBin) return null
    return this.cast(['receipt', hash, 'status'])
  }

  async receipt(hash: Hex): Promise<TransactionReceipt> {
    return this.client.waitForTransactionReceipt({
      hash,
      timeout: 180_000,
      pollingInterval: 1_000,
      retryCount: 10,
    })
  }

  /** Runs cast with retries: the single public testnet RPC occasionally resets connections. */
  private async cast(args: string[]): Promise<string> {
    if (!this.castBin) throw new Error('cast not available')
    const full = [...args, '--rpc-url', this.rpcUrl]
    let lastError: unknown
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const { stdout } = await run(this.castBin, full, { encoding: 'utf8', timeout: 60_000 })
        const out = stdout.trim()
        this.castLog.push({ cmd: `cast ${full.join(' ')}`, out })
        return out
      } catch (e) {
        lastError = e
        await new Promise((r) => setTimeout(r, 1_000 * (attempt + 1)))
      }
    }
    throw lastError
  }
}

function findCast(): string | null {
  if (process.env.E2E_NO_CAST === '1') return null
  try {
    execFileSync('cast', ['--version'], { stdio: 'ignore' })
    return 'cast'
  } catch {
    return null
  }
}

/** Formats a WAD/18-decimal amount for logs without float rounding. */
export function fmt18(v: bigint, dp = 6): string {
  const neg = v < 0n
  const a = neg ? -v : v
  const whole = a / 10n ** 18n
  const frac = (a % 10n ** 18n).toString().padStart(18, '0').slice(0, dp)
  return `${neg ? '-' : ''}${whole}.${frac}`
}

/** Parses a number out of UI text such as "21.75 MUSD" or "$72.59" (thousands separators allowed). */
export function parseUiNumber(text: string | null | undefined): number {
  const m = (text ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  if (!m) throw new Error(`No number in "${text}"`)
  return Number(m[0])
}
