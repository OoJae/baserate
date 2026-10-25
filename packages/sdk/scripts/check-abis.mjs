import { readFileSync } from 'node:fs'
import { toEventSignature, toFunctionSignature } from 'viem'

const sdk = await import(process.argv[2])
const map = {
  BorrowAccountFactory: 'borrowAccountFactoryAbi',
  BorrowAccount: 'borrowAccountAbi',
  WsMUSD: 'wsMusdAbi',
  BtcMusdOracle: 'btcMusdOracleAbi',
  MusdDispenser: 'musdDispenserAbi',
}
for (const [c, name] of Object.entries(map)) {
  const compiled = JSON.parse(readFileSync(`../../contracts/out/${c}.sol/${c}.json`, 'utf8')).abi
  const hand = sdk[name]
  if (!hand) {
    console.log(`${c}: no export ${name}`)
    continue
  }
  const sig = (x) =>
    x.type === 'function'
      ? toFunctionSignature(x)
      : x.type === 'event'
        ? toEventSignature(x)
        : x.type === 'error'
          ? `error ${x.name}(${x.inputs.map((i) => i.type).join(',')})`
          : null
  const C = new Set(compiled.map(sig).filter(Boolean))
  const H = hand.map(sig).filter(Boolean)
  const missing = H.filter((s) => !C.has(s))
  // also output-shape check for functions
  const outMismatch = hand
    .filter((x) => x.type === 'function')
    .filter((x) => {
      const m = compiled.find(
        (y) => y.type === 'function' && toFunctionSignature(y) === toFunctionSignature(x),
      )
      return (
        m &&
        JSON.stringify(m.outputs.map((o) => o.type)) !==
          JSON.stringify(x.outputs.map((o) => o.type))
      )
    })
    .map((x) => `${x.name} outputs`)
  console.log(
    `${c}: hand=${H.length} notInCompiled=${missing.length} ${missing.join(' | ')} ${outMismatch.length ? `OUTPUT MISMATCH: ${outMismatch.join(', ')}` : ''}`,
  )
}
