import { JSONSchemaType } from "ajv";
import { Network } from "./network.js";
import { ChainConfig } from "./chain-config.js";
import Ajv from "ajv";
import { promises as fs } from "fs";
import { ethers } from "ethers";
import { isUsdcOrUsdt } from "./token-util.js";
import { TokenInfo } from "./token-config.js";

export interface Token {
  chainId: bigint,
  tokenAddress: string,
}

export interface LP {
  lpid: string,
  baseToken: Token,
  token_1: Token,
  token_2: Token,
  maker: string, 
  gasCompensation: bigint,
  txFeeRatio: bigint,
}

export interface LPKey {
  lpId: string,
  isDeleted: boolean,
}

export function normalizeGasCompensation(
    chainConfig: ChainConfig,
    tokenInfo: TokenInfo,
    gasCompensation: bigint,
    baseChainId: number,
    srcChainId: number,
    dstChainId: number): bigint {

  const tokenName = tokenInfo.symbol;
  const tokenDecimal = tokenInfo.decimal;

  let result = gasCompensation;
  if (tokenName === "ETH") {
    if (baseChainId === 1) { // mainnet
      if (dstChainId === 1) {
        result = ethers.parseEther("0.003");
      } else if (dstChainId === 8453) {
        result = ethers.parseEther("0.0008");
      } else {
        result = ethers.parseEther("0.001");
      }
      if (srcChainId === 8453 && dstChainId != 1) {
        result = ethers.parseEther("0.0008");
      }
    } else if (chainConfig.isTestnetByChainId(baseChainId)) { // testnet
      if (dstChainId === 5 || dstChainId === 421613 || dstChainId === 280) {
        result = ethers.parseEther("0.005");
      } else if (dstChainId === 59140) {
        result = ethers.parseEther("0.2");
      } else {
        result = ethers.parseEther("0.001");
      }
    }
  } else if (tokenName === "BNB") {
    if (dstChainId === 56) { 
      result = ethers.parseEther("0.015");
    } else if (dstChainId === 204) {
      result = ethers.parseEther("0.0004");
    } else {
      result = ethers.parseEther("0.001");
    }
  } else if (isUsdcOrUsdt(tokenName)) {
    if (baseChainId === 1) {
      if (dstChainId === 1) {
        result = ethers.parseUnits("10", tokenDecimal);
      } else if (dstChainId === 42170) {
        result = ethers.parseUnits("0.8", tokenDecimal);
      } else {
        result = ethers.parseUnits("1.5", tokenDecimal);
      }
    } else if (chainConfig.isTestnetByChainId(baseChainId)) {
      if (dstChainId === 5 || dstChainId === 421613 || dstChainId === 280) {
        result = ethers.parseUnits("1", tokenDecimal);
      } else if (dstChainId === 59140) {
        result = ethers.parseUnits("1", tokenDecimal);
      } else {
        result = ethers.parseUnits("1", tokenDecimal);
      }
    }
  } else {
    throw new Error("Unsupported token: " + tokenName);
  }

  return result;
}

export function computeTxFee(txFeeRatio: bigint, value: bigint) {
  //return value * txFeeRatio / 100000000n / 100n;
  return 0n;
}

export function computeLpId(
    srcChainId: number,
    srcToken: string,
    dstChainId: number,
    dstToken: string,
    maker: string): string {
  if (srcChainId < dstChainId) {
    return ethers.solidityPackedKeccak256(
      ["uint256", "address", "uint256", "address", "address"],
      [srcChainId, srcToken, dstChainId, dstToken, maker]
    );
  } else {
    return ethers.solidityPackedKeccak256(
      ["uint256", "address", "uint256", "address", "address"],
      [dstChainId, dstToken, srcChainId, srcToken, maker]
    );
  }
}

export function computeLpGroupId(
    from_chainid: number,
    to_chainid: number,
    from_token: string,
    to_token: string
) {
  let result_hash = null;
  if (from_chainid < to_chainid) {
    result_hash = ethers.solidityPackedKeccak256(
      ["uint256", "uint256", "address", "address"],
      [BigInt(from_chainid), BigInt(to_chainid), from_token, to_token]
    );
  } else {
    result_hash = ethers.solidityPackedKeccak256(
      ["uint256", "uint256", "address", "address"],
      [BigInt(to_chainid), BigInt(from_chainid), to_token, from_token]
    );
  }
 
  return result_hash;
}


