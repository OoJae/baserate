import {
  type Address,
  type Client,
  encodeAbiParameters,
  type Hex,
  keccak256,
  numberToHex,
  parseSignature,
  type StateOverride,
  type TypedDataDomain,
} from 'viem'
import { getBlock, readContract } from 'viem/actions'
import { erc20PermitAbi } from './abis'

/**
 * EIP-2612 permits for MUSD.
 *
 * MUSD is OpenZeppelin v5 ERC20Permit with domain {"Mezo USD", "1", chainId, MUSD}, verified via EIP-5267 on
 * testnet (31611) and mainnet (31612). Permits accept plain ECDSA only: Safes and other contract wallets must use
 * the approve path. EIP-7702 EOAs (code `0xef0100…`) still sign as EOAs.
 */

export const MUSD_DOMAIN_NAME = 'Mezo USD'
export const MUSD_DOMAIN_VERSION = '1'

export const permitTypes = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const

export function musdPermitDomain(chainId: number, musd: Address): TypedDataDomain {
  return {
    name: MUSD_DOMAIN_NAME,
    version: MUSD_DOMAIN_VERSION,
    chainId,
    verifyingContract: musd,
  }
}

export interface MusdPermitParams {
  chainId: number
  musd: Address
  owner: Address
  spender: Address
  value: bigint
  nonce: bigint
  deadline: bigint
}

/** Typed data ready for `signTypedData` (viem or wagmi). */
export function buildMusdPermitTypedData(p: MusdPermitParams) {
  return {
    domain: musdPermitDomain(p.chainId, p.musd),
    types: permitTypes,
    primaryType: 'Permit' as const,
    message: {
      owner: p.owner,
      spender: p.spender,
      value: p.value,
      nonce: p.nonce,
      deadline: p.deadline,
    },
  }
}

export type MusdPermitTypedData = ReturnType<typeof buildMusdPermitTypedData>

export interface SplitSignature {
  v: number
  r: Hex
  s: Hex
}

/** Splits a 65-byte (or EIP-2098 64-byte) signature into the v, r, s that `permit` takes. */
export function splitPermitSignature(signature: Hex): SplitSignature {
  const sig = parseSignature(signature)
  const v = sig.v !== undefined ? Number(sig.v) : sig.yParity + 27
  return { v: v < 27 ? v + 27 : v, r: sig.r, s: sig.s }
}

export interface SignedPermit extends SplitSignature {
  signature: Hex
  value: bigint
  nonce: bigint
  deadline: bigint
}

/** Default permit lifetime: 20 minutes. */
export const DEFAULT_PERMIT_TTL_SECONDS = 20n * 60n

/**
 * Reads the owner's MUSD nonce, asks the wallet to sign the permit, and returns v, r, s.
 * `sign` is the wallet's `signTypedData` (viem WalletClient or wagmi action). Without an explicit `deadline`, the
 * permit expires {@link DEFAULT_PERMIT_TTL_SECONDS} after the latest block's timestamp.
 */
export async function signMusdPermit(args: {
  client: Client
  sign: (typedData: MusdPermitTypedData) => Promise<Hex>
  chainId: number
  musd: Address
  owner: Address
  spender: Address
  value: bigint
  deadline?: bigint
  now?: bigint
}): Promise<SignedPermit> {
  const nonce = await readContract(args.client, {
    address: args.musd,
    abi: erc20PermitAbi,
    functionName: 'nonces',
    args: [args.owner],
  })
  // Deadlines count from chain time, not the device clock, so a skewed clock cannot yield expired permits.
  const now =
    args.now ?? (args.deadline === undefined ? (await getBlock(args.client)).timestamp : 0n)
  const deadline = args.deadline ?? now + DEFAULT_PERMIT_TTL_SECONDS
  const typedData = buildMusdPermitTypedData({
    chainId: args.chainId,
    musd: args.musd,
    owner: args.owner,
    spender: args.spender,
    value: args.value,
    nonce,
    deadline,
  })
  const signature = await args.sign(typedData)
  return { ...splitPermitSignature(signature), signature, value: args.value, nonce, deadline }
}

/**
 * True when an address can sign MUSD permits: an EOA (no code) or an EIP-7702 delegated EOA (`0xef0100…`).
 * Contract wallets (Safe, smart accounts) must approve instead.
 */
export function canSignPermit(code: Hex | undefined): boolean {
  if (!code || code === '0x') return true
  return code.toLowerCase().startsWith('0xef0100')
}

/** Storage slot of `_allowances[owner][spender]` in MUSD (OpenZeppelin v5 ERC20: balances slot 0, allowances slot 1). */
export function musdAllowanceSlot(owner: Address, spender: Address): Hex {
  const inner = keccak256(
    encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [owner, 1n]),
  )
  return keccak256(
    encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [spender, inner]),
  )
}

/**
 * An `eth_call` state override that grants `spender` an MUSD allowance from `owner`. Used to pre-simulate the
 * transaction that will consume a permit before the user signs it (Mezo RPCs support `stateDiff` overrides).
 */
export function musdAllowanceOverride(
  musd: Address,
  owner: Address,
  spender: Address,
  value: bigint,
): StateOverride {
  return [
    {
      address: musd,
      stateDiff: [
        { slot: musdAllowanceSlot(owner, spender), value: numberToHex(value, { size: 32 }) },
      ],
    },
  ]
}
