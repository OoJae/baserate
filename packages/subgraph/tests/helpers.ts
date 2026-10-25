import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import { newMockEvent } from 'matchstick-as/assembly/index'

export const WAD = BigInt.fromString('1000000000000000000')

export function wad(units: i32): BigInt {
  return BigInt.fromI32(units).times(WAD)
}

/** A distinct 32-byte transaction hash per `n` (0..255). */
export function txHash(n: i32): Bytes {
  const hash = new Bytes(32)
  hash[0] = 0xaa
  hash[31] = n as u8
  return hash
}

/** A mock event from `address`, in transaction `tx`, at `logIndex` of block `block`. */
export function mockEvent(
  address: string,
  tx: Bytes,
  logIndex: i32,
  block: i32,
  params: ethereum.EventParam[],
): ethereum.Event {
  const e = newMockEvent()
  e.address = Address.fromString(address)
  e.transaction.hash = tx
  e.logIndex = BigInt.fromI32(logIndex)
  e.block.number = BigInt.fromI32(block)
  e.block.timestamp = BigInt.fromI32(1760000000 + block * 3)
  e.parameters = params
  return e
}

export function pAddress(name: string, value: string): ethereum.EventParam {
  return new ethereum.EventParam(name, ethereum.Value.fromAddress(Address.fromString(value)))
}

export function pUint(name: string, value: BigInt): ethereum.EventParam {
  return new ethereum.EventParam(name, ethereum.Value.fromUnsignedBigInt(value))
}

export function pInt(name: string, value: BigInt): ethereum.EventParam {
  return new ethereum.EventParam(name, ethereum.Value.fromSignedBigInt(value))
}

export function pSmall(name: string, value: i32): ethereum.EventParam {
  return new ethereum.EventParam(name, ethereum.Value.fromI32(value))
}

export function pBool(name: string, value: boolean): ethereum.EventParam {
  return new ethereum.EventParam(name, ethereum.Value.fromBoolean(value))
}

export function pFixed(name: string, value: string): ethereum.EventParam {
  return new ethereum.EventParam(name, ethereum.Value.fromFixedBytes(Bytes.fromHexString(value)))
}

export function pBytes(name: string, value: Bytes): ethereum.EventParam {
  return new ethereum.EventParam(name, ethereum.Value.fromBytes(value))
}

export function pFixedArray(name: string, values: Bytes[]): ethereum.EventParam {
  return new ethereum.EventParam(name, ethereum.Value.fromFixedBytesArray(values))
}

/** Hex id of an event entity: transaction hash + big-endian int32 log index. */
export function eventIdHex(tx: Bytes, logIndex: i32): string {
  return tx.concatI32(logIndex).toHexString()
}
