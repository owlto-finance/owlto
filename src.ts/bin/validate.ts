import { ethers } from "ethers";
import * as utils from "../utils/index.js";

export function isValidCrossChainSrcTxV2(
    networkName: string,
    chainConfig: utils.ChainConfig,
    makerConfig: utils.MakerConfig,
    starknetMakerconfig: utils.MakerConfig,
    sender: string | null,
    receiver: string | null,
    maker: string) {
  if (sender === null) {
    return false;
  }
  if (receiver === null) {
    return false;
  }
  // receiver must be maker
  if (receiver.toLowerCase() !== maker.toLowerCase()) {
    return false;
  }
  // maker can not cross to another maker
  if (makerConfig.hasMaker(sender) || starknetMakerconfig.hasMaker(sender)) {
    return false;
  }

  return true;
}

export function isValidNativeTransferTx(tx: ethers.TransactionResponse) {
  if (tx.chainId === null) {
    return false;
  }
  if (tx.hash === null) {
    return false;
  }
  if (tx.from === null) {
    return false;
  }
  if (tx.to === null || tx.to === ethers.ZeroAddress) {
    return false;
  }

  if (tx.data != null) { // not contract call
    return false;
  }

  return true;
}

export function isValidErc20TransferTx(tx: ethers.TransactionResponse) {
  if (tx.chainId === null) {
    return false;
  }
  if (tx.hash === null) {
    return false;
  }
  if (tx.from === null) {
    return false;
  }
  if (tx.to === null || tx.to === ethers.ZeroAddress) {
    return false;
  }
  if (tx.data === null || !tx.data.startsWith("0xa9059cbb")) {
    return false;
  }
  return true;
}

export function isValidDstTx(
    networkName: string,
    chainConfig: utils.ChainConfig,
    makerConfig: utils.MakerConfig,
    sender: string | null,
    receiver: string | null,
    maker: string,
    value: bigint) {

  if (sender == null) {
    return false;
  }
  if (receiver == null) {
    return false;
  }
  // sender must be maker
  if (sender.toLowerCase() !== maker.toLowerCase()) {
    return false;
  }

  return true;
}

