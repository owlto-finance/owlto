import { ethers } from "ethers";
import { getChecksumAddress } from "starknet";

export function isValidAddress(address: string): boolean {
  return address.startsWith("0x")
	     && ethers.isHexString(address)
	     && (address.length == 42);
}

export function privateKeyToAddress(privateKey: string): string {
  const wallet = new ethers.Wallet(privateKey);
  return wallet.address;
}

export function isValidPrivateKey(key: string): boolean {
  return key.startsWith("0x")
             && ethers.isHexString(key)
             && key.length === 66;
}

export function normalizeAddress(address: string, backendName?: string): string {
  if (backendName !== undefined) {
    if (backendName === "starknet") {
      return getChecksumAddress(address);
    } else if (backendName === "ethers") {
      let tmp = address;
      if (tmp.startsWith("0x")) {
        tmp = tmp.substring(2);
      }
      const keyLen = tmp.length;
      if (keyLen < 40) {
        tmp = "0".repeat(40 - keyLen) + tmp;
      }
      tmp = "0x" + tmp;
      return ethers.getAddress(tmp);
    } else {
      throw new Error(`Unknown backend name: ${backendName}`);
    }
  } else {
    if (address.length === 42) {
      return ethers.getAddress(address);
    } else {
      return getChecksumAddress(address);
    }
  }
}

export function isEvmAddress(address: string): boolean {
  return address.length === 42;
}
