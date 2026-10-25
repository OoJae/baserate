import {
  type Address,
  createPublicClient,
  custom,
  decodeFunctionData,
  domainSeparator,
  encodeAbiParameters,
  encodeFunctionResult,
  type Hex,
  hashTypedData,
  keccak256,
  recoverTypedDataAddress,
  toHex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'
import { erc20PermitAbi } from '../src/abis'
import { mezoTestnet } from '../src/chains'
import {
  buildMusdPermitTypedData,
  canSignPermit,
  musdAllowanceOverride,
  musdAllowanceSlot,
  musdPermitDomain,
  permitTypes,
  signMusdPermit,
  splitPermitSignature,
} from '../src/permit'

const MUSD_TESTNET: Address = '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503'
const MUSD_MAINNET: Address = '0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186'
/** DOMAIN_SEPARATOR() read from each chain on 2026-10-25. */
const TESTNET_DOMAIN_SEPARATOR =
  '0x6f9f5c5d441374bdc3939f5da85a145469d7ffbc96bfe0cce59e5de7d8f1474f'
const MAINNET_DOMAIN_SEPARATOR =
  '0x0a43819914359cf08d7ef52ccb53aadf5478d3d2fc676003ccb84491d09a3e93'
/** keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)") */
const PERMIT_TYPEHASH = keccak256(
  toHex('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)'),
)

/** Throwaway key derived at test time; never a real key. */
const account = privateKeyToAccount(keccak256(toHex('baserate-sdk-permit-test')))
const SPENDER: Address = '0x0000000000000000000000000000000000000beE'

describe('MUSD permit domain', () => {
  it('matches the on-chain DOMAIN_SEPARATOR on testnet and mainnet', () => {
    expect(domainSeparator({ domain: musdPermitDomain(31_611, MUSD_TESTNET) })).toBe(
      TESTNET_DOMAIN_SEPARATOR,
    )
    expect(domainSeparator({ domain: musdPermitDomain(31_612, MUSD_MAINNET) })).toBe(
      MAINNET_DOMAIN_SEPARATOR,
    )
  })

  it('uses the canonical EIP-2612 Permit type', () => {
    expect(permitTypes.Permit.map((f) => `${f.type} ${f.name}`).join(',')).toBe(
      'address owner,address spender,uint256 value,uint256 nonce,uint256 deadline',
    )
    expect(PERMIT_TYPEHASH).toBe(
      '0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9',
    )
  })
})

describe('permit typed data', () => {
  const params = {
    chainId: 31_611,
    musd: MUSD_TESTNET,
    owner: account.address,
    spender: SPENDER,
    value: 40_040_000_000_000_000_000n,
    nonce: 3n,
    deadline: 1_792_946_000n,
  }

  it('hashes to the EIP-712 digest MUSD verifies', () => {
    const td = buildMusdPermitTypedData(params)
    const structHash = keccak256(
      encodeAbiParameters(
        [
          { type: 'bytes32' },
          { type: 'address' },
          { type: 'address' },
          { type: 'uint256' },
          { type: 'uint256' },
          { type: 'uint256' },
        ],
        [
          PERMIT_TYPEHASH,
          params.owner,
          params.spender,
          params.value,
          params.nonce,
          params.deadline,
        ],
      ),
    )
    const digest = keccak256(`0x1901${TESTNET_DOMAIN_SEPARATOR.slice(2)}${structHash.slice(2)}`)
    expect(hashTypedData(td)).toBe(digest)
  })

  it('signs, splits into v/r/s and recovers the owner', async () => {
    const td = buildMusdPermitTypedData(params)
    const signature = await account.signTypedData(td)
    const { v, r, s } = splitPermitSignature(signature)
    expect([27, 28]).toContain(v)
    expect(r).toMatch(/^0x[0-9a-f]{64}$/)
    expect(s).toMatch(/^0x[0-9a-f]{64}$/)
    expect(await recoverTypedDataAddress({ ...td, signature })).toBe(account.address)
  })

  it('reads the nonce from MUSD and signs end to end', async () => {
    const calls: Hex[] = []
    const client = createPublicClient({
      chain: mezoTestnet,
      transport: custom({
        async request({ method, params: rpcParams }) {
          if (method === 'eth_call') {
            const [{ data, to }] = rpcParams as [{ data: Hex; to: Address }]
            expect(to.toLowerCase()).toBe(MUSD_TESTNET.toLowerCase())
            calls.push(data)
            const decoded = decodeFunctionData({ abi: erc20PermitAbi, data })
            expect(decoded.functionName).toBe('nonces')
            return encodeFunctionResult({
              abi: erc20PermitAbi,
              functionName: 'nonces',
              result: 7n,
            })
          }
          if (method === 'eth_chainId') return '0x7b7b'
          if (method === 'eth_getBlockByNumber') {
            // Chain time, deliberately far from the test machine's clock.
            return {
              number: '0x10',
              hash: `0x${'11'.repeat(32)}`,
              timestamp: '0x3e8',
              transactions: [],
            }
          }
          throw new Error(`unexpected ${method}`)
        },
      }),
    })
    const permit = await signMusdPermit({
      client,
      sign: (td) => account.signTypedData(td),
      chainId: 31_611,
      musd: MUSD_TESTNET,
      owner: account.address,
      spender: SPENDER,
      value: 10n ** 18n,
    })
    expect(calls).toHaveLength(1)
    expect(permit.nonce).toBe(7n)
    // Deadline = latest block timestamp (1,000) + 20 minutes, independent of the device clock.
    expect(permit.deadline).toBe(1_000n + 1_200n)
    const td = buildMusdPermitTypedData({
      chainId: 31_611,
      musd: MUSD_TESTNET,
      owner: account.address,
      spender: SPENDER,
      value: 10n ** 18n,
      nonce: 7n,
      deadline: permit.deadline,
    })
    expect(await recoverTypedDataAddress({ ...td, signature: permit.signature })).toBe(
      account.address,
    )
  })
})

describe('permit capability and allowance overrides', () => {
  it('treats EOAs and EIP-7702 delegated EOAs as permit-capable', () => {
    expect(canSignPermit(undefined)).toBe(true)
    expect(canSignPermit('0x')).toBe(true)
    expect(canSignPermit('0xef01001234567890123456789012345678901234567890')).toBe(true)
    expect(canSignPermit('0x6080604052')).toBe(false)
  })

  it('locates MUSD allowances at mapping slot 1 (verified live with an eth_call override)', () => {
    expect(
      musdAllowanceSlot(
        '0x000000000000000000000000000000000000dEaD',
        '0x0000000000000000000000000000000000000beE',
      ),
    ).toBe('0x0d68dab5259a1e56f598cc4eb37a1f40a92a54c5603ef4476b3e89227169e876')
    const override = musdAllowanceOverride(MUSD_TESTNET, account.address, SPENDER, 2_000n)
    expect(override[0]?.address).toBe(MUSD_TESTNET)
    expect(override[0]?.stateDiff?.[0]?.value).toBe(
      '0x00000000000000000000000000000000000000000000000000000000000007d0',
    )
  })
})
