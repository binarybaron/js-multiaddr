
import * as ip from './ip.js'
import { getProtocol } from './protocols-table.js'
import { CID } from 'multiformats/cid'
import { base32 } from 'multiformats/bases/base32'
import { base58btc } from 'multiformats/bases/base58'
import * as Digest from 'multiformats/hashes/digest'
import varint from 'varint'
import { toString as uint8ArrayToString } from 'uint8arrays/to-string'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'
import { concat as uint8ArrayConcat } from 'uint8arrays/concat'

/**
 * converts (serializes) addresses
 */
export function convert (proto: string, a: string | Uint8Array) {
  if (a instanceof Uint8Array) {
    return convertToString(proto, a)
  } else {
    return convertToBytes(proto, a)
  }
}

/**
 * Convert [code,Uint8Array] to string
 */
export function convertToString (proto: number | string, buf: Uint8Array) {
  const protocol = getProtocol(proto)
  switch (protocol.code) {
    case 4: // ipv4
    case 41: // ipv6
      return bytes2ip(buf)

    case 6: // tcp
    case 273: // udp
    case 33: // dccp
    case 132: // sctp
      return bytes2port(buf).toString()

    case 53: // dns
    case 54: // dns4
    case 55: // dns6
    case 56: // dnsaddr
    case 400: // unix
    case 777: // memory
      return bytes2str(buf)

    case 421: // ipfs
      return bytes2mh(buf)
    case 444: // onion
      return bytes2onion(buf)
    case 445: // onion3
      return bytes2onion(buf)
    default:
      return uint8ArrayToString(buf, 'base16') // no clue. convert to hex
  }
}

export function convertToBytes (proto: string | number, str: string) {
  const protocol = getProtocol(proto)
  switch (protocol.code) {
    case 4: // ipv4
      return ip2bytes(str)
    case 41: // ipv6
      return ip2bytes(str)

    case 6: // tcp
    case 273: // udp
    case 33: // dccp
    case 132: // sctp
      return port2bytes(parseInt(str, 10))

    case 53: // dns
    case 54: // dns4
    case 55: // dns6
    case 56: // dnsaddr
    case 400: // unix
    case 777: // memory
      return str2bytes(str)

    case 421: // ipfs
      return mh2bytes(str)
    case 444: // onion
      return onion2bytes(str)
    case 445: // onion3
      return onion32bytes(str)
    default:
      return uint8ArrayFromString(str, 'base16') // no clue. convert from hex
  }
}

function ip2bytes (ipString: string) {
  if (!ip.isIP(ipString)) {
    throw new Error('invalid ip address')
  }
  return ip.toBytes(ipString)
}

function bytes2ip (ipBuff: Uint8Array) {
  const ipString = ip.toString(ipBuff, 0, ipBuff.length)
  if (ipString == null || !ip.isIP(ipString)) {
    throw new Error('invalid ip address')
  }
  return ipString
}

function port2bytes (port: number) {
  const buf = new ArrayBuffer(2)
  const view = new DataView(buf)
  view.setUint16(0, port)

  return new Uint8Array(buf)
}

function bytes2port (buf: Uint8Array) {
  const view = new DataView(buf.buffer)
  return view.getUint16(buf.byteOffset)
}

function str2bytes (str: string) {
  const buf = uint8ArrayFromString(str)
  const size = Uint8Array.from(varint.encode(buf.length))
  return uint8ArrayConcat([size, buf], size.length + buf.length)
}

function bytes2str (buf: Uint8Array) {
  const size = varint.decode(buf)
  buf = buf.slice(varint.decode.bytes)

  if (buf.length !== size) {
    throw new Error('inconsistent lengths')
  }

  return uint8ArrayToString(buf)
}

function mh2bytes (hash: string) {
  let mh

  if (hash[0] === 'Q' || hash[0] === '1') {
    mh = Digest.decode(base58btc.decode(`z${hash}`)).bytes
  } else {
    mh = CID.parse(hash).multihash.bytes
  }

  // the address is a varint prefixed multihash string representation
  const size = Uint8Array.from(varint.encode(mh.length))
  return uint8ArrayConcat([size, mh], size.length + mh.length)
}

/**
 * Converts bytes to bas58btc string
 */
function bytes2mh (buf: Uint8Array) {
  const size = varint.decode(buf)
  const address = buf.slice(varint.decode.bytes)

  if (address.length !== size) {
    throw new Error('inconsistent lengths')
  }

  return uint8ArrayToString(address, 'base58btc')
}

function onion2bytes (str: string) {
  const addr = str.split(':')
  if (addr.length !== 2) {
    throw new Error(`failed to parse onion addr: ["'${addr.join('", "')}'"]' does not contain a port number`)
  }
  if (addr[0].length !== 16) {
    throw new Error(`failed to parse onion addr: ${addr[0]} not a Tor onion address.`)
  }

  // onion addresses do not include the multibase prefix, add it before decoding
  const buf = base32.decode('b' + addr[0])

  // onion port number
  const port = parseInt(addr[1], 10)
  if (port < 1 || port > 65536) {
    throw new Error('Port number is not in range(1, 65536)')
  }
  const portBuf = port2bytes(port)
  return uint8ArrayConcat([buf, portBuf], buf.length + portBuf.length)
}

function onion32bytes (str: string) {
  const addr = str.split(':')
  if (addr.length !== 2) {
    throw new Error(`failed to parse onion addr: ["'${addr.join('", "')}'"]' does not contain a port number`)
  }
  if (addr[0].length !== 56) {
    throw new Error(`failed to parse onion addr: ${addr[0]} not a Tor onion3 address.`)
  }
  // onion addresses do not include the multibase prefix, add it before decoding
  const buf = base32.decode(`b${addr[0]}`)

  // onion port number
  const port = parseInt(addr[1], 10)
  if (port < 1 || port > 65536) {
    throw new Error('Port number is not in range(1, 65536)')
  }
  const portBuf = port2bytes(port)
  return uint8ArrayConcat([buf, portBuf], buf.length + portBuf.length)
}

function bytes2onion (buf: Uint8Array) {
  const addrBytes = buf.slice(0, buf.length - 2)
  const portBytes = buf.slice(buf.length - 2)
  const addr = uint8ArrayToString(addrBytes, 'base32')
  const port = bytes2port(portBytes)
  return `${addr}:${port}`
}
