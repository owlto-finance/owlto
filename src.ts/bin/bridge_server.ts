import dotenv from "dotenv";
dotenv.config();

import * as utils from "../utils/index.js";
import { t_src_transaction, t_transfer, t_dynamic_dtc } from "@prisma/client";
import { ethers } from "ethers";
import {
  Backend,
  loadBackend,
  Config as BackendConfig,
  getBridgeConfig as getBackendConfig,
  SendTransactionResult,
  GasPriceResult
} from "../backends/index.js";
import axios from "axios";

interface Config extends BackendConfig {
  shardId: number,
}

async function getConfig(configDir: string): Promise<Config> {
  if (process.env.BRIDGE_SERVER_SHARD_ID === undefined) {
    throw new Error("BRIDGE_SERVER_SHARD_ID in .env is not set");
  }
  const shardIdStr = process.env.BRIDGE_SERVER_SHARD_ID;
  if (utils.isAllDigitString(shardIdStr) === false) {
    throw new Error("BRIDGE_SERVER_SHARD_ID in .env is not a number");
  }

  const config = await getBackendConfig(configDir, 0);
  return {
    ...config,
    shardId: Number(shardIdStr),
  }
}


function getDynamicDtc(dynamic_dtc: t_dynamic_dtc, srcValue: string, tokenDecimal: number, dstTokenDecimal: number) {
  const srcValueFloat = parseFloat(ethers.formatUnits(srcValue, tokenDecimal));
  if (srcValueFloat < parseFloat(dynamic_dtc.amount_lv1) + parseFloat(dynamic_dtc.dtc_lv1)) {
    return ethers.parseUnits(dynamic_dtc.dtc_lv1, dstTokenDecimal);
  } else if (srcValueFloat < parseFloat(dynamic_dtc.amount_lv2) + parseFloat(dynamic_dtc.dtc_lv2)) {
    return ethers.parseUnits(dynamic_dtc.dtc_lv2, dstTokenDecimal);
  } else if (srcValueFloat < parseFloat(dynamic_dtc.amount_lv3) + parseFloat(dynamic_dtc.dtc_lv3)) {
    return ethers.parseUnits(dynamic_dtc.dtc_lv3, dstTokenDecimal);
  } else {
    return ethers.parseUnits(dynamic_dtc.dtc_lv4, dstTokenDecimal);
  }
}

async function getDestinationAddressInBytes32(config: Config, messenger: ethers.Interface, address: string): Promise<string> {
  const provider = config.chainConfig.getProviderByName("EthereumGoerli");
  const message_contranct = new ethers.Contract("0x1a9695e9dbdb443f4b20e3e4ce87c8d963fda34f", messenger, provider);
  return message_contranct.addressToBytes32(address);
}

async function invokeTokenMessengerContract(
    config: Config, 
    provider: ethers.Provider, 
    chainInfo: utils.ChainInfo,
    contract: string,
    tokenMessenger: ethers.Interface,
    amount: bigint,
    domain: number,
    destinationAddressInBytes32: string,
    usdc_address: string,
    nonce: number): Promise<string> {
  const feeData = await provider.getFeeData();
  const wallet = config.chainConfig.makerConfig.getEthersSigner(config.env, provider);
  let estimatedGas: bigint
  const tx: ethers.TransactionRequest = {
    to: contract,
    value: 0x0,
    gasLimit: utils.bigint2Hex(0n),
    nonce: nonce,
    type: 2,
    chainId: chainInfo.chainId,
    data: tokenMessenger.encodeFunctionData("depositForBurn", [amount, domain, destinationAddressInBytes32, usdc_address]),
  }

  if (feeData.maxPriorityFeePerGas === null && feeData.gasPrice !== null) { // pre EIP-1599
    estimatedGas = await wallet.estimateGas({
      to: contract,
      value: 0x0,
      type: 0x0,
      chainId: chainInfo.chainId,
      data: tokenMessenger.encodeFunctionData("depositForBurn", [amount, domain, destinationAddressInBytes32, usdc_address]),
    });
    estimatedGas = estimatedGas + estimatedGas * 10n / 100n;
    tx.gasPrice = feeData.gasPrice + ethers.parseUnits("10", "gwei");
    tx.type = 0x0;
    tx.gasLimit = utils.bigint2Hex(estimatedGas);
  } else {
    estimatedGas = await wallet.estimateGas({
      to: contract,
      value: 0x0,
      type: 2,
      chainId: chainInfo.chainId,
      data: tokenMessenger.encodeFunctionData("depositForBurn", [amount, domain,  destinationAddressInBytes32, usdc_address]),
    });
    estimatedGas = estimatedGas + estimatedGas * 10n / 100n;
    tx.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas! + feeData.maxPriorityFeePerGas! * 15n / 100n;
    tx.maxFeePerGas = feeData.maxFeePerGas! + ethers.parseUnits("20", "gwei");;
    tx.gasLimit = utils.bigint2Hex(estimatedGas);
  }

  const rsp = await wallet.sendTransaction(tx);

  return rsp.hash;
}

async function invokeTransmitterContract(
    config: Config, 
    provider: ethers.Provider, 
    chainInfo: utils.ChainInfo,
    contract: string,
    transmitter: ethers.Interface,
    messageBytes: string,
    attestationSignature: string,
    nonce: number): Promise<string> {
  const feeData = await provider.getFeeData();
  const wallet = config.chainConfig.makerConfig.getEthersSigner(config.env, provider);
  let estimatedGas: bigint
  const tx: ethers.TransactionRequest = {
    to: contract,
    value: 0x0,
    gasLimit: utils.bigint2Hex(0n),
    nonce: nonce,
    type: 2,
    chainId: chainInfo.chainId,
    data: transmitter.encodeFunctionData("receiveMessage", [messageBytes, attestationSignature]),
  }

  if (feeData.maxPriorityFeePerGas === null && feeData.gasPrice !== null) { // pre EIP-1599
    estimatedGas = await wallet.estimateGas({
      to: contract,
      value: 0x0,
      type: 0x0,
      chainId: chainInfo.chainId,
      data: transmitter.encodeFunctionData("receiveMessage", [messageBytes, attestationSignature]),
    });
    estimatedGas = estimatedGas + estimatedGas * 10n / 100n;
    tx.gasPrice = feeData.gasPrice + ethers.parseUnits("10", "gwei");
    tx.type = 0x0;
    tx.gasLimit = utils.bigint2Hex(estimatedGas);
  } else {
    estimatedGas = await wallet.estimateGas({
      to: contract,
      value: 0x0,
      type: 2,
      chainId: chainInfo.chainId,
      data: transmitter.encodeFunctionData("receiveMessage", [messageBytes, attestationSignature]),
    });
    estimatedGas = estimatedGas + estimatedGas * 10n / 100n;
    tx.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas! + feeData.maxPriorityFeePerGas! * 15n / 100n;
    tx.maxFeePerGas = feeData.maxFeePerGas! + ethers.parseUnits("20", "gwei");;
    tx.gasLimit = utils.bigint2Hex(estimatedGas);
  }

  const rsp = await wallet.sendTransaction(tx);  
  return rsp.hash;
}

function secondsLater(seconds: number) {
  return Math.floor(Date.now() / 1000) + seconds;
}

async function getSpeedupEvents(
    config: Config,
    supportedChainIds: Array<number>,
    now: number) {

  const events = await config.db.t_src_transaction.findMany({
    where: {
      is_processed: 1,
      is_locked: 0,
      is_verified: 0,
      is_invalid: 0,
      dst_chainid: {
        in: supportedChainIds,
      },
      next_time: {
        lte: now,
      },
      insert_timestamp: {
        gt: new Date("2023-07-10"),
      },
      is_cctp: {
        not: 1,
      },
    },
    orderBy: [{
      insert_timestamp: 'asc',
    }],
    take: 5,
  });
  return events;
}

async function getUnProcessedTransferEvents(
    config: Config,
    supportedChainIds: Array<number>) {

  const events = await config.db.t_transfer.findMany({
    where: {
      is_processed: 0,
      is_invalid: 0,
      chainid: { in: supportedChainIds },
    },
    orderBy: [
      { insert_timestamp: 'asc' },
    ],
    take: 1,
  });

  return events;
}

async function getUnProcessedCCTPEvents(
    config: Config,
    supportedChainIds: Array<number>,
    now: number) {
  const events = new Array<t_src_transaction>();
  const status_0 = await config.db.t_src_transaction.findMany({
    where: {
      is_invalid: 0,
      is_locked: 0,
      is_verified: 0,
      dst_chainid: {
        in: supportedChainIds,
      },
      next_time: {
        lte: now,
      },
      is_cctp: 1,
      cctp_status: 0,
    },
    orderBy: [{
      insert_timestamp: 'asc',
    }],
    take: 1,
  });
  events.push(...status_0);

  const status_1 = await config.db.t_src_transaction.findMany({
    where: {
      is_invalid: 0,
      is_locked: 0,
      is_verified: 0,
      dst_chainid: {
        in: supportedChainIds,
      },
      next_time: {
        lte: now,
      },
      is_cctp: 1,
      cctp_status: 1,
    },
    orderBy: [{
      insert_timestamp: 'asc',
    }],
    take: 1,
  });
  events.push(...status_1);

  const status_2 = await config.db.t_src_transaction.findMany({
    where: {
      is_invalid: 0,
      is_locked: 0,
      is_verified: 0,
      dst_chainid: {
        in: supportedChainIds,
      },
      is_cctp: 1,
      cctp_status: 2,
    },
    orderBy: [{
      insert_timestamp: 'asc',
    }],
    take: 1,
  });
  events.push(...status_2);

  const status_3 = await config.db.t_src_transaction.findMany({
    where: {
      is_invalid: 0,
      is_locked: 0,
      is_verified: 0,
      dst_chainid: {
        in: supportedChainIds,
      },
      is_cctp: 1,
      cctp_status: 3,
    },
    orderBy: [{
      insert_timestamp: 'asc',
    }],
    take: 1,
  });
  events.push(...status_3);
  return events;
}

async function getUnProcessedEvents(
    config: Config,
    supportedChainIds: Array<number>,
    now: number) {

  const events = await config.db.t_src_transaction.findMany({
    where: {
      is_processed: 0,
      is_invalid: 0,
      is_locked: 0,
      dst_chainid: {
        in: supportedChainIds,
      },
      next_time: {
        lte: now,
      },
      is_cctp: {
        not: 1,
      }
    },
    orderBy: [{
      insert_timestamp: 'asc',
    }],
    take: 100,
  });

  return events;
}

async function setProcessedAndUnlock(
    config: Config,
    isSpeedup: boolean,
    srcChainId: number,
    srcTxHash: string,
    dstChainId: number,
    dstTxHash: string,
    dstNonce: number,
    gasTokenInfo: utils.TokenInfo,
    dstTokenInfo: utils.TokenInfo,
    dstEstimatedGasLimit: bigint,
    dstEstimatedGasPrice: bigint,
    dstMaxFeePerGas: bigint,
    dstValue: string,
    bridgeFee: string) {

  let nextTime = Math.floor(Date.now() / 1000) + 120;
  if (isSpeedup) { // for speeding up networks
    if (dstChainId === 1101) {
      nextTime = Math.floor(Date.now() / 1000) + 4 * 60;
    } else if (dstChainId === 666666666) {
      nextTime = Math.floor(Date.now() / 1000) + 5 * 60;
    } else {
      nextTime = Math.floor(Date.now() / 1000) + 60;
    }
  }

  return config.db.t_src_transaction.update({
    where: {
      chainid_tx_hash: {
        chainid: srcChainId,
        tx_hash: srcTxHash,
      },
    },
    data: {
      is_processed: 1,
      dst_chainid: dstChainId,
      dst_tx_hash: dstTxHash,
      dst_nonce: dstNonce,
      gas_token_name: gasTokenInfo.symbol,
      gas_token_decimal: gasTokenInfo.decimal,
      dst_token_decimal: dstTokenInfo.decimal,
      dst_estimated_gas_limit: dstEstimatedGasLimit.toString(),
      dst_estimated_gas_price: dstEstimatedGasPrice.toString(),
      dst_max_fee_per_gas: dstMaxFeePerGas.toString(),
      dst_value: dstValue,
      bridge_fee: bridgeFee,
      next_time: nextTime,
      is_locked: 0,
    },
  });
}

async function setCCTPProcessedAndUnlock(
    config: Config,
    srcChainId: number,
    srcTxHash: string,
    dstChainId: number,
    status: number,
    burnHash: string,
    dstValue: BigInt,
    gasTokenInfo: utils.TokenInfo) {
  return config.db.t_src_transaction.update({
    where: {
      chainid_tx_hash: {
        chainid: srcChainId,
        tx_hash: srcTxHash,
      },
    },
    data: {
      is_processed: 1,
      dst_chainid: dstChainId,
      is_locked: 0,
      cctp_status: status,
      cctp_burnHash: burnHash,
      dst_value: dstValue.toString(),
      gas_token_name: gasTokenInfo.symbol,
      gas_token_decimal: gasTokenInfo.decimal,
    },
  });
}

async function setInvalid(config: Config, chainId: number, txHash: string, invalid_code: number) {
  return config.db.$executeRaw`
    UPDATE t_src_transaction
    SET is_invalid =${invalid_code} 
    WHERE chainid = ${chainId}
    AND LOWER(tx_hash) = LOWER(${txHash})
  `;
}

async function setDstChainId(config: Config, chainId: number, txHash: string, dstChainId: number) {
  return config.db.$executeRaw`
    UPDATE t_src_transaction
    SET dst_chainid =${dstChainId}
    WHERE chainid = ${chainId}
    AND LOWER(tx_hash) = LOWER(${txHash})
  `;
}


async function setInvalidAndUnlock(config: Config, chainId: number, txHash: string, invalid_code: number) {
  return config.db.$executeRaw`
    UPDATE t_src_transaction
    SET is_invalid =${invalid_code}, is_locked=0 
    WHERE chainid = ${chainId}
    AND LOWER(tx_hash) = LOWER(${txHash})
  `;
}

async function setCCTPInvalidAndUnlock(config: Config, chainId: number, txHash: string, invalid_code: number) {
  return config.db.$executeRaw`
    UPDATE t_src_transaction
    SET is_invalid =${invalid_code}, is_locked=0 
    WHERE chainid = ${chainId}
    AND LOWER(tx_hash) = LOWER(${txHash})
  `;
}


async function setDstEstimatedGasPriceAndUnlock(
    config: Config,
    chainId: number,
    txHash: string,
    dstEstimatedGasPrice: bigint,
    dstMaxFeePerGas: bigint) {

  return config.db.t_src_transaction.update({
    where: {
      chainid_tx_hash: {
        chainid: chainId,
        tx_hash: txHash,
      },
    },
    data: {
      dst_estimated_gas_price: dstEstimatedGasPrice.toString(),
      dst_max_fee_per_gas: dstMaxFeePerGas.toString(),
      next_time: Math.floor(Date.now() / 1000) + 60,
      is_locked: 0,
    },
  });
}

async function updateNextTime(config: Config, chainId: number, txHash: string, nextTime: number) {
  return config.db.t_src_transaction.update({
    where: { 
      chainid_tx_hash: {
        chainid: chainId,
        tx_hash: txHash,
      },
    },
    data: {
      next_time: nextTime,
    }, 
  });
}

async function addNewUser(config: Config, user: string) {
  return config.db.t_user.upsert({
    where: {
      user: user,
    },
    create: {
      user: user,
    },
    update: {},
  });
}

function getSupportedChainIds(config: Config): Array<number> {
  let chainIds: Array<number> = [];
  for (const [name, network] of config.txNetworkConfig) {
    if (network.tx_enable === true || network.log_enable === true) {
      chainIds.push(network.chainId);
    }
  }
  return chainIds;
}

function computeDstValue(srcValue: string, txFeeRatio: bigint, rowGasCompensation: bigint, dstChainId: number, srcTokenDecimal: number, dstTokenDecimal: number): [bigint, bigint] {
  const maxDecimal = srcTokenDecimal > dstTokenDecimal ? srcTokenDecimal : dstTokenDecimal;
  const amount = ethers.parseUnits(srcValue, maxDecimal - srcTokenDecimal);
  const gasCompensation = ethers.parseUnits(rowGasCompensation.toString(), maxDecimal - dstTokenDecimal);
  let txFee = (amount - gasCompensation) * txFeeRatio / 100000000n / 100n;

  let dstValue: bigint;
  dstValue = amount - gasCompensation - txFee;

  txFee = txFee / ethers.parseUnits("1", maxDecimal - dstTokenDecimal);
  dstValue = dstValue / ethers.parseUnits("1", maxDecimal - dstTokenDecimal);

  return [dstValue, txFee];
}

function extractDstChainId(config: Config, srcValue: string): number {
  if (srcValue.length < 5) {
    throw new Error("user transfer value too small");
  }
  const dstChainCode = parseInt(srcValue.slice(-4));
  return config.chainConfig.getChainIdByNetworkCode(dstChainCode);
}

async function getDstChainIdFromTxAction(
    config: Config,
    chainId: number,
    txHash: string) {
  const item = await config.db.t_tx_action.findFirst({
    select: {
      transation_amount: true,
    },
    where: {
      chainid: chainId,
      tx_hash: txHash,
    },
  });

  if (item === null) {
    throw new Error("item not found in tx_action");
  }

  return extractDstChainId(config, item.transation_amount);
}

function getDstTokenInfo(
    tokenConfig: utils.TokenConfig,
    srcChainId: number,
    srcTokenAddress: string,
    dstChainId: number) {
  const tokenName = tokenConfig.getSymbol(srcChainId, srcTokenAddress);

  const dstTokenInfo = tokenConfig.getInfoBySymbolAndChainId(
      tokenName, dstChainId);

  return dstTokenInfo;
}

async function getWatchFlag(config: Config): Promise<number> {
  const flag = await config.db.t_counter.findUnique({
    select: { counter: true },
    where: { id: config.makerWatchCounterId },
  });

  if (flag === null) {
    return 0;
  }
  return flag.counter;
}

function isSpeedupTx(config: Config, supportedChainIds: Array<number>, tx: t_src_transaction): boolean {
  if (tx.is_processed === 1 &&
      tx.is_invalid === 0 &&
      tx.is_verified === 0 &&
      tx.dst_chainid !== null &&
      tx.dst_chainid > 0 &&
      supportedChainIds.includes(tx.dst_chainid) &&
      tx.dst_tx_hash !== null &&
      tx.dst_nonce >= 0) {
    return true;
  }
  return false;
}

async function isGasTooHigh(
    chainId: number,
    backend: Backend,
    tokenInfo: utils.TokenInfo,
    estimatedGas: bigint,
    gasPrice: GasPriceResult,
    gasTokenInfo: utils.TokenInfo,
    gasCompensation: bigint) {

  if (tokenInfo.symbol !== "ETH") {
    return false;
  }
  let gasFee: bigint;
  if (gasPrice.maxFeePerGas === null) {
    gasFee = estimatedGas * gasPrice.gasPrice;
  } else {
    const baseFee = await backend.getBaseFee("latest");
    if (baseFee === null) {
      throw new Error("baseFee is null");
    }
    gasFee = estimatedGas * (baseFee + baseFee * 15n / 100n + gasPrice.gasPrice);
  }

  utils.log("transaction fee:", ethers.formatUnits(gasFee, gasTokenInfo.decimal));
  if ((chainId === 1 || chainId === 666666666 || chainId === 534352) && gasFee >= gasCompensation) {
    return true;
  }

  return false;
}

async function markDstTxVerified(config: Config, dstChainId: number, dstTxHash: string) {
  return config.db.t_src_transaction.updateMany({
    where: {
      dst_chainid: dstChainId,
      dst_tx_hash: dstTxHash,
    },
    data: {
      is_verified: 1,
    },
  });
}

async function Lock(config: Config, chainId: number, txHash: string) {
  return config.db.t_src_transaction.update({
    where: {
      chainid_tx_hash: {
        chainid: chainId,
        tx_hash: txHash,
      }
    },
    data: {
      is_locked: 1,
    },
  });
}

async function Unlock(config: Config, chainId: number, txHash: string) {
  return config.db.t_src_transaction.update({
    where: {
      chainid_tx_hash: {
        chainid: chainId,
        tx_hash: txHash,
      }
    },
    data: {
      is_locked: 0,
    },
  });
}

async function setUnlockWithNextTime(config: Config, chainId: number, txHash: string, nextTime: number) {
  return config.db.t_src_transaction.update({
    where: {
      chainid_tx_hash: {
        chainid: chainId,
        tx_hash: txHash,
      }
    },
    data: {
      is_locked: 0,
      next_time: nextTime,
    },
  });
}

function buildAlertMsg(
    msg: string,
    srcChainName: string,
    dstChainName: string | null,
    tokenName: string,
    srcValueStr: string,
    srcTxHash: string) {

  if (dstChainName === null) {
    return msg + ", " + srcChainName + " -> ?, "  + tokenName + ": " + srcValueStr + ", src_tx_hash=" + srcTxHash;
  } else {
    return msg + ", " + srcChainName + " -> " + dstChainName + ", " + tokenName + ": " + srcValueStr + ", src_tx_hash=" + srcTxHash;
  }
}

async function sendAlert(
    config: Config,
    msg: string,
    isTestnet: number,
    srcChainName: string,
    dstChainName: string | null,
    tokenName: string,
    srcValueStr: string,
    srcTxHash: string,
    isDust: boolean = false) {
  const errMsg = buildAlertMsg(msg, srcChainName, dstChainName, tokenName, srcValueStr, srcTxHash);
  utils.log(errMsg);
  if (isDust) {
    utils.alertDust(config.env, errMsg);
  } else {
    utils.alertMakerByNetwork(config.env, isTestnet, errMsg);
  }
}

function addNextTime(nextTime: number, add: number) {
  if (nextTime === 0) {
    const nowDate = new Date();
    const now = Math.floor(nowDate.getTime() / 1000);
    return now + add;
  } else {
    return nextTime + add;
  }
}

function isRetryableError(dstChainInfo: utils.ChainInfo, msg: string) {
  if (msg === null) {
    return false;
  }

  if (dstChainInfo.chainId === 324
      && msg === "failed to validate the transaction. reason: Validation revert: Account validation error: Error function_selector = 0x, data = 0x") {
    return true;
  }

  if (dstChainInfo.name.startsWith("Starknet")
     && msg.includes("Transaction's nonce must be greater than or equal to the last known nonce.")) {
    return true;
  }

  /*
  if (dstChainInfo.name.startsWith("Linea")
      && msg.includes("transaction would cause overdraft")) {
    return true;
  }*/

  return false;
}

function isInsufficientFundsError(dstChainInfo: utils.ChainInfo, msg: string) {
  if (msg === null) {
    return false;
  }

  if (msg.includes("insufficient funds for gas * price + value")) {
    return true;
  }

  return false;
}


function getDstUserAddress(
    srcChainInfo: utils.ChainInfo,
    dstChainInfo: utils.ChainInfo,
    sender: string,
    targetAddress: string | null): string | null {

  const dstBackendName = dstChainInfo.backend;

  if (srcChainInfo.name.startsWith("Starknet") || dstChainInfo.name.startsWith("Starknet")) {
    if (targetAddress === null) {
      return null;
    }
    return utils.normalizeAddress(targetAddress, dstBackendName);
  }
  return utils.normalizeAddress(sender);
}

async function getLpInfo(
    config: Config,
    tokenName: string,
    fromChainName: string,
    toChainName: string,
    makerAddress: string) {

  const currentVersion = await config.db.t_counter.findFirst({
    where: {
      id: 2,
    },
  });

  if (currentVersion === null) {
    return null;
  }

  const version: number = currentVersion.counter;
  const lp = await config.db.t_lp_info.findFirst({
    where: {
      //version_token_name_from_chain_to_chain_maker_address: {
        version: version,
        token_name: tokenName,
        from_chain: fromChainName,
        to_chain: toChainName,
        maker_address: makerAddress,
      //},
    },
  });

  return lp;
}

async function updateShardTime(config: Config) {
  return config.db.t_bridge_server_shard.update({
    where: {
      id: config.shardId,
    },
    data: {
      last_update_timestamp: new Date(),
    },
  });
}

function isLiquidityAddress(sender: string) {
  // old security address
  if (sender === "0x3Dc40d707e22be5c670F6C7A5a7878AEdDa7ca17") {
    return true;
  }
  if (sender === "0x042751948a9eb3BDDbD96a565c9d7B8F1EeeDD2cFEc004796A3daFBA12DdfeE8") {
    return true;
  }

  if (sender === "0x1A9b315367Fc746b479DBB6a143A10cd4642AAd8") {
    return true;
  }
  if (sender === "0x8a94b2dfDa8b396DDBe30fCa2B7DEA1C0E02a3B7") {
    return true;
  }
  if (sender === "0x04b9794fe32947699b824445b5FdbCCAC9Cd5F6d7df63ADE3F4a95a0627B1e0D") {
    return true;
  }

  return false;
}

async function setTransferInvalid(config: Config, id: bigint, invalid_code: number) {
  return config.db.t_transfer.update({
    where: {
      id: id,
    },
    data: {
      is_invalid: invalid_code,
    },
  });
}

async function setCCTPInvalid(config: Config, id: bigint, invalid_code: number) {
  return config.db.t_src_transaction.update({
    where: {
      id: id,
    },
    data: {
      is_invalid: invalid_code,
    },
  });
}

async function updateCCTPStatus(config: Config, id: bigint, status_code: number) {
  return config.db.t_src_transaction.update({
    where: {
      id: id,
    },
    data: {
      cctp_status: status_code,
    },
  });
}

async function setTransferProcessed(
    config: Config,
    id: bigint,
    txHash: string
  ) {

  return config.db.t_transfer.update({
    where: {
      id: id,
    },
    data: {
      is_processed: 1,
      tx_hash: txHash,
    },
  });
}


async function processTransferEvents(
    config: Config,
    nonceMap: Map<string, number>,
    events: t_transfer[]) {

  for (const event of events) {
    let nonceKey = "nonce";
    try {
      const id = event.id;
      const chainId = event.chainid;
      const targetAddress = utils.normalizeAddress(event.to_address);
      const amount = BigInt(event.value);
      const updateTimestamp = event.update_timestamp;
      const insertTimestamp = event.insert_timestamp;

      const isStop = await config.db.t_counter.findUnique({
        where: {
          id: 102,
        },
      });
      if (isStop == null) {
        return;
      }
      if (isStop.counter === 1) {
        utils.log("t_counter 102 is 1, stop");
        return;
      }

      const tokenName = event.token_name;
      let dstTokenInfo: utils.TokenInfo;
      try {
        dstTokenInfo = config.tokenConfig.getInfoBySymbolAndChainId(tokenName, chainId);
      } catch (error) {
        utils.log("transfer, token not found, chainid=" + chainId + ", tokenName=" + tokenName);
        await setTransferInvalid(config, id, 1);
        continue;
      }
      const dstTokenAddress = dstTokenInfo.address;
      const dstTokenDecimal = dstTokenInfo.decimal;
      const dstTokenReadableAmount = ethers.formatUnits(amount, dstTokenDecimal);

      const dstChainInfo = config.chainConfig.getChainInfoByChainId(chainId);
      const dstChainName = dstChainInfo.name;
      const backend = await loadBackend(config, dstChainName);

      utils.log("transfer,", dstChainName, targetAddress, dstTokenReadableAmount, dstTokenInfo.symbol);

      const gasTokenInfo = config.tokenConfig.getInfoBySymbolAndChainName(dstChainInfo.gasToken, dstChainName);

      let dstMaker: string;
      if (dstChainName.startsWith("Starknet")) {
        dstMaker = config.starknetMakerConfig.getMakerAddress(config.env);;
      } else {
        dstMaker = config.makerConfig.getMakerAddress(config.env);;
      }

      nonceKey = chainId + "_" + dstMaker.toLowerCase();
      utils.log("transfer, nonceKey is", nonceKey);
      const nonce = await getNonce(config, backend, dstMaker, nonceKey, nonceMap);

      let estimatedGas: bigint;
      try {
        if (dstTokenInfo.address === ethers.ZeroAddress) {
          estimatedGas = await backend.estimateNativeTransferGas(targetAddress, amount);
        } else {
          estimatedGas = await backend.estimateERC20TransferGas(dstTokenInfo.address, targetAddress, amount);
        }
      } catch (error) {
        const anyError = error as any;
        if ("reason" in anyError) {
          if (anyError["reason"] === "ERC20: transfer amount exceeds balance") {
            await setTransferInvalid(config, id, 16);
            utils.log("transfer, transfer amount exceeds balance, id=" + id + ", user=" + targetAddress + ", tokenName=" + tokenName + ", amount=" + dstTokenReadableAmount);
            continue;
          } else {
            utils.log("transfer, estimate gas fail, error=" + error + ", id=" + id + ", user=" + targetAddress + ", tokenName=" + tokenName + ", amount=" + dstTokenReadableAmount);
            throw error;
          }
        } else if ("code" in anyError) {
          if (anyError["code"] === "INSUFFICIENT_FUNDS") {
            await setTransferInvalid(config, id, 17);
            utils.log("transfer, insufficient funds, id=" + id + ", user=" + targetAddress + ", tokenName=" + tokenName + ", amount=" + dstTokenReadableAmount);
            continue;
          } else {
            utils.log("transfer, estimate gas fail in code, error=" + error + ", id=" + id + ", user=" + targetAddress + ", tokenName=" + tokenName + ", amount=" + dstTokenReadableAmount);
            throw error;
          }
        } else {
          throw error;
        }
      }

      const gasPrice = await backend.estimateGasPrice({
        isSpeedUp: false,
        oldGasPrice: 0n,
        oldMaxPriorityFeePerGas: 0n,
        oldMaxFeePerGas: 0n,
      }, estimatedGas, dstTokenInfo.address === ethers.ZeroAddress);

      let rspTx: SendTransactionResult
      try {
	      if (dstTokenInfo.address == ethers.ZeroAddress) {
		      rspTx = await backend.sendNativeTransfer({
			      to: targetAddress,
			      value: amount,
			      gasLimit: estimatedGas,
			      nonce: nonce,
			      gasPrice: gasPrice,
			    });
        } else {
		      rspTx = await backend.sendERC20Transfer({
				    tokenAddress: dstTokenInfo.address,
					  recipient: targetAddress,
					  value: amount,
					  gasLimit: estimatedGas,
					  nonce: nonce,
            gasPrice: gasPrice,
		      });
        }
      } catch (error) {
        utils.log("transfer, transfer expcetion, chainid=" + chainId + ", error=" + error);
        if (error instanceof Error) {
          if (error.message.includes("code=REPLACEMENT_UNDERPRICED")) {
            utils.log("replacement_underprice, " + error + ", id=" + id + ", user=" + targetAddress + ", tokenName=" + tokenName + ", amount=" + dstTokenReadableAmount);
            throw error;
          } else if (error.message.includes("code=NONCE_")) { // nonce expired, retry
            utils.log("nonce error, " + error + ", id=" + id + ", user=" + targetAddress + ", tokenName=" + tokenName + ", amount=" + dstTokenReadableAmount);
            throw error;
          } else if (error.message.includes("\"message\": \"already known\"")) { // tx_hash still in memory pool
            await setTransferInvalid(config, id, 2);
            utils.log("already known, " + error + ", id=" + id + ", user=" + targetAddress + ", tokenName=" + tokenName + ", amount=" + dstTokenReadableAmount);
          } else {
            await setTransferInvalid(config, id, 3);
            utils.log("send failed, " + error + ", id=" + id + ", user=" + targetAddress + ", tokenName=" + tokenName + ", amount=" + dstTokenReadableAmount);
          }
        } else {
          await setTransferInvalid(config, id, 4);
          utils.log("other error, " + error + ", id=" + id + ", user=" + targetAddress + ", tokenName=" + tokenName + ", amount=" + dstTokenReadableAmount);
        }
        continue;
      }
      nonceMap.set(nonceKey, nonce + 1);

      await setTransferProcessed(config, id, rspTx.hash.toLowerCase());
    } catch (err) {
      nonceMap.delete(nonceKey);
      utils.log("transfer error, " + err);
    }
  }
}


async function processCCTPEvents(
    config: Config,
    nonceMap: Map<string, number>,
    events: t_src_transaction[],
    messenger: ethers.Interface,
    transmitter: ethers.Interface,
    tokenMessenger: ethers.Interface) {

  for (const event of events) {
    let nonceKey = "nonce";
    const id = event.id;
    const chainId = event.chainid;
    const txHash = event.tx_hash;
    if (event.cctp_status === 0 || event.cctp_status === 1) {
      try {
        //get all datas
        const sender = utils.normalizeAddress(event.sender);
        const maker = utils.normalizeAddress(event.receiver);
        const tokenAddress = event.token;
        const targetAddress = event.target_address;
        const srcValue = event.value;
        let nextTime = event.next_time;
        const manualDstChainId = event.dst_chainid;

        const srcIsTestnet = config.chainConfig.isTestnetByChainId(chainId);
        const srcChainInfo = config.chainConfig.getChainInfoByChainId(chainId);
        const srcChainName = srcChainInfo.name;
        const backend = await loadBackend(config, srcChainName);

        const tokenInfo = config.tokenConfig.getInfoByChainIdAndAddress(chainId, tokenAddress);
        const tokenName = tokenInfo.symbol;
        if (tokenName !== "USDC") {
          await setCCTPInvalid(config, id, 1001); 
          continue;
        }
        const tokenDecimal = tokenInfo.decimal;

        const srcValueBig = BigInt(srcValue);
        const srcValueStr = ethers.formatUnits(srcValueBig, tokenDecimal);

        let dstChainId: number;
        try {
          dstChainId = extractDstChainId(config, srcValue);
        } catch (error) {
          if (manualDstChainId !== null && manualDstChainId > 0) {
            dstChainId = manualDstChainId;
            const tmpDstChainInfo = config.chainConfig.getChainInfoByChainId(dstChainId);
            sendAlert(config, "cctp use manual dst_chainid", srcIsTestnet, srcChainName, tmpDstChainInfo.name, tokenName, srcValueStr, txHash);
          } else {
            try {
              dstChainId = await getDstChainIdFromTxAction(config, chainId, txHash);
            } catch {
              await setCCTPInvalid(config, id, 1002);
              continue;
            }
          }
        }

        const dstChainInfo = config.chainConfig.getChainInfoByChainId(dstChainId);
        const dstChainName = dstChainInfo.name;
        const now = utils.now();

        const gasTokenInfo = config.tokenConfig.getInfoBySymbolAndChainName(dstChainInfo.gasToken, dstChainName);

        const dtc = await utils.getCCTP_DTC(config.db, chainId, dstChainId);
        const dtcBig = ethers.parseUnits(dtc, tokenDecimal);
        if (srcValueBig <= dtcBig) {
          sendAlert(config, "cctp value too small", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
          await setCCTPInvalid(config, id, 1020);
          continue;
        }
        const dstValueBig = srcValueBig - dtcBig;

        // check if ...
        if (!srcChainInfo.enable || !dstChainInfo.enable) {
          sendAlert(config, "cctp chain not enabled", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
          await setCCTPInvalid(config, id, 1003);
          continue;
        }

        if (event.is_locked === 1) {
          sendAlert(config, "cctp locked", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
          continue;
        }

        if (sender.toLowerCase() == maker.toLowerCase()) {
          sendAlert(config, "cctp sender is equal to maker", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
          await setCCTPInvalid(config, id, 1005);
          continue;
        }
        // maker -> maker will cause infinite loop
        if (config.starknetMakerConfig.hasMaker(sender.toLowerCase()) ||
            config.makerConfig.hasMaker(sender.toLowerCase())) {
          sendAlert(config, "cctp sender is one of the makers", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
          await setCCTPInvalid(config, id, 1006);
          continue;
        }
        
        const srcLatestBlcok = await backend.getBlockNumber();
        const srcHashBlock = await backend.getTxBlockNumber(txHash);
        if (srcHashBlock === null) {
          sendAlert(config, "cctp source tx not found", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
          continue;
        }
        if (srcChainName === "EthereumMainnet" && srcLatestBlcok - srcHashBlock < 16) {
          utils.log("cctp ignore source tx, block too new, chainid=" + chainId + ", tx_hash=" + txHash);
          nextTime = nextTime + srcChainInfo.blockInterval;
          await updateNextTime(config, chainId, txHash, nextTime);
          continue;
        } else if (srcLatestBlcok - srcHashBlock < 10) {
          utils.log("cctp ignore source tx, block too new, chainid=" + chainId + ", tx_hash=" + txHash);
          nextTime = nextTime + srcChainInfo.blockInterval;
          await updateNextTime(config, chainId, txHash, nextTime);
          continue;
        }
       
        const txStatus = await backend.getTxStatus(txHash);
        if (txStatus === null) {
          utils.log("tx not found or waiting, chainid=" + chainId + ", tx_hash=" + txHash);
          nextTime = (nextTime === 0 ? now + 10 : nextTime + 10);
          await updateNextTime(config, chainId, txHash, nextTime);
          continue;
        } else if (txStatus !== true) {
          sendAlert(config, "cctp ignore source tx, status == 0", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
          await setCCTPInvalid(config, id, 1007);
          continue;
        }

        nonceKey = chainId + "_" + maker.toLowerCase();
        utils.log("CCTP, nonceKey is", nonceKey);
        let nonce = await getNonce(config, backend, maker, nonceKey, nonceMap);
      
        const dstUserAddress = getDstUserAddress(srcChainInfo, dstChainInfo, sender, targetAddress);
        if (dstUserAddress === null) {
          sendAlert(config, "cctp dstUserAddress is null", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
          await setCCTPInvalid(config, id, 1011);
          continue;
        }

        //get cctp info
        const src_cctp_info = await config.db.t_cctp_support_chain.findUnique({
          where: {
            chainid: chainId,
          },
        });
        if (src_cctp_info === null) {
          sendAlert(config, "cctp not supported", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
          await setCCTPInvalid(config, id, 1008);
          continue;
        }
        const dst_cctp_info = await config.db.t_cctp_support_chain.findUnique({
          where: {
            chainid: dstChainId,
          },
        });
        if (dst_cctp_info === null) {
          sendAlert(config, "cctp not supported", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
          await setCCTPInvalid(config, id, 1009);
          continue;
        }

        let estimatedGas: bigint;
        const gasPrice = await backend.getGasPrice();
        //----------------- approve --------------------------
        const allowance = await backend.getAllowance(src_cctp_info.token_messenger!, tokenAddress);
        if (BigInt(allowance) < dstValueBig) {
          //in case repeat approve
          if (event.cctp_status === 1 && event.update_timestamp.getTime() > now - 2 * 60 * 1000) {
            continue;
          }
          try {
            estimatedGas = await backend.estimateApproveERC20Gas(tokenAddress, dstValueBig, src_cctp_info.token_messenger!);
          } catch (error) {
            sendAlert(config, "cctp estimateApproveERC20Gas failed", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
            const nextTime = secondsLater(10 * 60);
            await setUnlockWithNextTime(config, chainId, txHash, nextTime);
            continue;
          }
          const approveTxHash = await backend.approveERC20({
            tokenAddress: tokenAddress,
            value: ethers.parseUnits("50000", tokenDecimal),
            gasLimit: estimatedGas,
            nonce: nonce,
            gasPrice: gasPrice,
            spender: src_cctp_info.token_messenger!,
          });
          utils.log("approveTxHash", approveTxHash);
          nonceMap.set(nonceKey, nonce + 1);
          await updateCCTPStatus(config, id, 1);
        } else { //----------------------  Burn USDC --------------------------
          let destinationAddressInBytes32: string | null = null;
          try {
            destinationAddressInBytes32 = await getDestinationAddressInBytes32(config, messenger, dstUserAddress);
          } catch (error) {
            sendAlert(config, "cctp getDestinationAddressInBytes32 failed", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
            await setCCTPInvalid(config, id, 1010);
            continue;
          }
        
          await Lock(config, chainId, txHash); 
          let rsp: string|null = null;
          try {
            rsp = await invokeTokenMessengerContract(
              config, 
              config.chainConfig.getProviderByChainId(chainId),
              srcChainInfo,
              src_cctp_info.token_messenger!,
              tokenMessenger,
              dstValueBig,
              dst_cctp_info.domain!,
              destinationAddressInBytes32,
              tokenAddress,
              nonce);
          } catch (error) {
            utils.log("cctp transfer expcetion, chainid=" + chainId + ", tx_hash=" + txHash + ", error=" + error);
            if (error instanceof Error) {
              if (error.message.includes("code=REPLACEMENT_UNDERPRICED")) {
                sendAlert(config, "cctp replacement underpriced, " + error, srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
                await Unlock(config, chainId, txHash);
                throw error;
              } else if (error.message.includes("code=NONCE_")) { // nonce expired, retry
                await Unlock(config, chainId, txHash);
                throw error;
              } else if (error.message.includes("mempool is full")) {
                const nextTime = secondsLater(30 * 60);
                await setUnlockWithNextTime(config, chainId, txHash, nextTime);
                sendAlert(config, "cctp mempool is full, try next time" + error, srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
              } else if (dstChainName.startsWith("Bnb") && error.message.includes("transaction underpriced")) {
                await Unlock(config, chainId, txHash);
                throw error;
              } else if (dstChainName.startsWith("Starknet") && error.message.includes("Invalid transaction nonce")) {
                await Unlock(config, chainId, txHash);
                throw error;
              } else if (dstChainName.startsWith("Zeta") && error.message.includes("invalid nonce")) {
                await Unlock(config, chainId, txHash);
                throw error;
              } else if (isRetryableError(dstChainInfo, error.message)) {
                const nextTime = Math.floor(Date.now() / 1000) + 5 * 60;
                await setUnlockWithNextTime(config, chainId, txHash, nextTime);
              } else if (error.message.includes("\"message\": \"already known\"")) { // tx_hash still in memory pool
                await Unlock(config, chainId, txHash);
                throw error;
              } else if (error.message.includes("request failed or timed out")) {
                sendAlert(config, "cctp rpc request timeout, " + error, srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
                await setInvalidAndUnlock(config, chainId, txHash, 1012);
              } else {
                sendAlert(config, "cctp send tx failed, " + error, srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
                await setInvalidAndUnlock(config, chainId, txHash, 1013);
              }
            } else {
              sendAlert(config, "cctp send tx failed, not type error, " + error, srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
              await setInvalidAndUnlock(config, chainId, txHash, 1014);
            }
            continue;
          }
          await setCCTPProcessedAndUnlock(config, chainId, txHash, dstChainId, 2, rsp!, dstValueBig, gasTokenInfo);
          nonceMap.set(nonceKey, nonce + 1);
        }//if BigInt(allowance) < dstValueBig
      } catch (error) {
          nonceMap.delete(nonceKey);
      } // for ;;
    } else if (event.cctp_status === 2) { 
      // ------------------------------ get attestation ------------------------------
      if (event.cctp_burnHash === null) {
        await setCCTPInvalid(config, id, 1015);
        continue;
      }
      try {
        let burnBytes: string | null = null;
        if (event.cctp_messageBytes === null) {
          const eventTopic = "0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036";
          const provider = config.chainConfig.getProviderByChainId(chainId);
          const srcChainInfo = config.chainConfig.getChainInfoByChainId(chainId);
          const srcChainName = srcChainInfo.name;
          const backend = await loadBackend(config, srcChainName);
          let isdone: boolean | null = null;
          try {
            isdone = await backend.getTxStatus(event.cctp_burnHash);
          } catch (error) {
            await setCCTPInvalid(config, id, 1017);
            continue;
          }
          if (isdone === true) {
            const txReceipt = await provider.getTransactionReceipt(event.cctp_burnHash);
            const exactLog = txReceipt!.logs.find(log => log.topics[0] === eventTopic);
            burnBytes = new ethers.AbiCoder().decode(['bytes'], exactLog!.data)[0];
            await config.db.t_src_transaction.update({
              where: {
                chainid_tx_hash: {
                  chainid: chainId,
                  tx_hash: txHash,
                },
              },
              data: {
                cctp_messageBytes: burnBytes,
              },
            });
          } else {
            continue;
          }
        } else {
          burnBytes = event.cctp_messageBytes;
        }
        const messageHash = ethers.keccak256(burnBytes!);
        const srcIsTestnet = config.chainConfig.isTestnetByChainId(chainId);
        let url = srcIsTestnet === 0 ? "https://iris-api.circle.com/v1/attestations/" : "https://iris-api-sandbox.circle.com/v1/attestations/";
        url += messageHash;
        try {
          const urlrsp = await axios.get(url, { headers : { Accpept: "application/json" }});
          if (urlrsp.data.status === 'complete') {
            await config.db.t_src_transaction.update({
              where: {
                chainid_tx_hash: {
                  chainid: chainId,
                  tx_hash: txHash,
                },
              },
              data: {
                cctp_status: 3,
                cctp_attestationSignature: urlrsp.data.attestation,
              },
            });
          }
        } catch (error) {
          continue;
        }
      } catch (error) {
        await setCCTPInvalid(config, id, 1016);
        continue;
      }
    } else if (event.cctp_status === 3) { 
      // ------------------------------ recieve funds on destination chain and address ------------------------------
      if (event.cctp_messageBytes === null || event.cctp_attestationSignature === null) {
        await setCCTPInvalid(config, event.id, 1018);
        continue;
      }

      if (event.dst_chainid === null) {
        await setCCTPInvalid(config, event.id, 1019);
        continue;
      }

      let rsp: string | null = null;
      const maker = utils.normalizeAddress(event.receiver);
      const dstChainInfo = config.chainConfig.getChainInfoByChainId(event.dst_chainid);
      const dstChainName = dstChainInfo.name;
      const dstbackend = await loadBackend(config, dstChainName);
      try {
        const nonceKey = event.dst_chainid + "_" + maker.toLowerCase();
        utils.log("CCTP, nonceKey is", nonceKey);
        let nonce = await getNonce(config, dstbackend, maker, nonceKey, nonceMap);
        const dst_cctp_info = await config.db.t_cctp_support_chain.findUnique({
          where: {
            chainid: event.dst_chainid,
          },
        });
        rsp = await invokeTransmitterContract(
          config,
          config.chainConfig.getProviderByChainId(event.dst_chainid),
          config.chainConfig.getChainInfoByChainId(event.dst_chainid),
          dst_cctp_info!.message_transmitter!, 
          transmitter,
          event.cctp_messageBytes,
          event.cctp_attestationSignature,
          nonce);
        nonceMap.set(nonceKey, nonce + 1);
     } catch (error) {
       utils.log("recieve funds on destination chain", error);
       nonceMap.delete(nonceKey);
       continue;
     }

      await config.db.t_src_transaction.update({
        where: {
          chainid_tx_hash: {
            chainid: chainId,
            tx_hash: txHash,
         },
        },
        data: {
          is_processed: 1,
          cctp_status: 4,
          is_verified: 1,
          cctp_dstHash: rsp,
       },
      });
    }
  }
}

async function getNonce(
    config: Config,
    backend: Backend,
    dstMaker: string,
    nonceKey: string,
    nonceMap: Map<string, number>): Promise<number> {

  let nonce = 0;
  if (!nonceMap.has(nonceKey) ||
      nonceMap.get(nonceKey) === 0) {

    nonce = await backend.getNonce(dstMaker);
    nonceMap.set(nonceKey, nonce);
    utils.log("nonce (query blockchain) is", nonce);
  } else {
    nonce = nonceMap.get(nonceKey)!;
    utils.log("nonce (from memory) is", nonce);
  }
  return nonce;
}

function isSuperSmallValue(tokenName: string, srcValueBig: bigint) {
  if (tokenName !== "ETH") {
    return false;
  }
  const threshold = ethers.parseEther("0.00001");
  if (srcValueBig < threshold) {
    return true;
  }
  return false;
}

async function main() {
  const config = await getConfig("config");

  const messengerContractAbi = await utils.getErc20Abi("config/abi/CCTP/Message.json");
  const messengerObj = JSON.parse(messengerContractAbi);
  const transmitterContractAbi = await utils.getErc20Abi("config/abi/CCTP/MessageTransmitter.json");
  const transmitterObj = JSON.parse(transmitterContractAbi);
  const tokenMessengerAbi = await utils.getErc20Abi("config/abi/CCTP/TokenMessenger.json");
  const tokenMessengerObj = JSON.parse(tokenMessengerAbi);

  const messenger = ethers.Interface.from(messengerObj);
  const transmitter = ethers.Interface.from(transmitterObj);
  const tokenMessenger = ethers.Interface.from(tokenMessengerObj);

  const nonceMap = new Map<string, number>();

  const supportedChainIds = config.dstChainConfig.getChainIds();

  utils.log("supportedChainIds:", supportedChainIds);

  let lastUpdateTime = utils.now();
  for (;;) {
    const roundBeginTime = utils.now();
    if (roundBeginTime - lastUpdateTime < 60) {
      await utils.sleep(1);
    }

    const now = utils.now();
    lastUpdateTime = now;

    const unprocessedTransferEvents = await getUnProcessedTransferEvents(config, supportedChainIds);
    const unprocessedCCTPEvents = await getUnProcessedCCTPEvents(config, supportedChainIds, now);

    const unprocessedEvents = await getUnProcessedEvents(config, supportedChainIds, now);
    const speedupEvents = await getSpeedupEvents(config, supportedChainIds, now);
    const events = [...unprocessedEvents, ...speedupEvents];

    // process transfer
    await processTransferEvents(config, nonceMap, unprocessedTransferEvents);
    await processCCTPEvents(config, nonceMap, unprocessedCCTPEvents, messenger, transmitter, tokenMessenger);
    let nonceKey = "nonce";

    for (const event of events) {
      try {
        const sender = utils.normalizeAddress(event.sender);
        const maker = utils.normalizeAddress(event.receiver);
        const chainId = event.chainid;
        const txHash = event.tx_hash;
        const tokenAddress = event.token;
        const targetAddress = event.target_address;
        const srcValue = event.value;
        const updateTimestamp = event.update_timestamp;
        const insertTimestamp = event.insert_timestamp;
        const isProcessed = event.is_processed;
        let nextTime = event.next_time;
        const isLocked = event.is_locked; // in case
        const manualDstChainId = event.dst_chainid;

        const srcIsTestnet = config.chainConfig.isTestnetByChainId(chainId);
        const srcChainInfo = config.chainConfig.getChainInfoByChainId(chainId);
        const srcChainName = srcChainInfo.name;

        const tokenInfo = config.tokenConfig.getInfoByChainIdAndAddress(chainId, tokenAddress);
        const tokenName = tokenInfo.symbol;
        const tokenDecimal = tokenInfo.decimal;

        const srcValueBig = BigInt(srcValue);
        const srcValueStr = ethers.formatUnits(srcValueBig, tokenDecimal);

        await addNewUser(config, sender);

        utils.log("chainId:", chainId);
        utils.log("txHash:", txHash);

        let dstChainId: number;
        try {
          dstChainId = extractDstChainId(config, srcValue);
        } catch (error) {
          if (manualDstChainId !== null && manualDstChainId > 0) {
              dstChainId = manualDstChainId;
              const tmpDstChainInfo = config.chainConfig.getChainInfoByChainId(dstChainId);
              sendAlert(config, "use manual dst_chainid", srcIsTestnet, srcChainName, tmpDstChainInfo.name, tokenName, srcValueStr, txHash);
          } else {
          // query network code from tx_action
            try {
              dstChainId = await getDstChainIdFromTxAction(config, chainId, txHash);
            } catch {
              const networkCodeGapTime = 2 * 60;
              const timeDiff = Math.floor((updateTimestamp.getTime() - insertTimestamp.getTime()) / 1000);
              if (timeDiff > networkCodeGapTime) {
                const isDust = isSuperSmallValue(tokenName, srcValueBig);
                let msg: string;
                if (isLiquidityAddress(sender)) {
                  msg = "add liquidity";
                } else {
                  msg = "networtCode not supported";
                }
                if (isDust) {
                  msg = "dust attack";
                }

                sendAlert(config, msg, srcIsTestnet, srcChainName, null, tokenName, srcValueStr, txHash, isDust);
                if (isDust === true) {
                  await setInvalid(config, chainId, txHash, 21);
                } else {
                  await setInvalid(config, chainId, txHash, 14);
                }
              } else {
                nextTime = addNextTime(nextTime, networkCodeGapTime);
                await updateNextTime(config, chainId, txHash, nextTime);
              }
              continue;
            }
          }
        }

        const dstChainInfo = config.chainConfig.getChainInfoByChainId(dstChainId);
        const dstChainName = dstChainInfo.name;
	      const backend = await loadBackend(config, dstChainName);

        utils.log("dstChainName=", dstChainName);
        if (!srcChainInfo.enable || !dstChainInfo.enable) {
          sendAlert(config, "chain not enabled", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
          await setInvalid(config, chainId, txHash, 15);
          continue;
        }

        /*
        if (dstChainId === 204) {
          sendAlert(config, "to OpbnbMainnet stop", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
          await setInvalid(config, chainId, txHash, 20);
          continue;
        }*/
        // gasToken
        const gasTokenInfo = config.tokenConfig.getInfoBySymbolAndChainName(dstChainInfo.gasToken, dstChainName);
        const srcBackend = await loadBackend(config, srcChainName);
        // token must be configured, ETH is supported by default
        let dstTokenInfo: utils.TokenInfo;
        try {
          dstTokenInfo = getDstTokenInfo(config.tokenConfig, chainId, tokenAddress, dstChainId);
        } catch (error) {
          sendAlert(config, "get dstTokenInfo error", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
          await setInvalid(config, chainId, txHash, 1);
          continue;
        }
        const dstTokenAddress = dstTokenInfo.address;

        if (isLocked) {
          sendAlert(config, "locked", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
          continue;
        }

        if (tokenName === "ETH") {
          if (!srcIsTestnet) {
            let maxValue = ethers.parseEther("2.1");
            if (srcChainName === "ScrollMainnet" || dstChainName === "ScrollMainnet") {
              maxValue = ethers.parseEther("2.1");
            }
            if (BigInt(srcValue) > maxValue) {
              sendAlert(config, "src value is too large", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
              await setInvalid(config, chainId, txHash, 11);
              continue;
            }
          }
        }

        // for speed up
        const isSpeedup = isSpeedupTx(config, supportedChainIds, event);
        if (isProcessed === 1 && isSpeedup === false) { // All txs processed must be speedup transaction
          sendAlert(config, "invalid speed up tx", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
          continue;
        }
        // the following 3 variables have been checked in isSpeedupTx
        const oldDstChainId: number = event.dst_chainid!;
        const oldDstTxHash: string = event.dst_tx_hash!;
        const oldDstNonce: number = event.dst_nonce!;
        let oldDstEstimatedGasPrice: bigint | null = null;
        if (event.dst_estimated_gas_price !== null) {
          oldDstEstimatedGasPrice = BigInt(event.dst_estimated_gas_price);
        }
        let oldDstMaxFeePerGas: bigint | null = null;
        if (event.dst_max_fee_per_gas !== null ) {
          oldDstMaxFeePerGas = BigInt(event.dst_max_fee_per_gas);
        }

        if (sender.toLowerCase() == maker.toLowerCase()) {
          sendAlert(config, "sender is equal to maker", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
          await setInvalid(config, chainId, txHash, 1);
          continue;
        }
        // maker -> maker will cause infinite loop
        if (config.starknetMakerConfig.hasMaker(sender.toLowerCase()) ||
            config.makerConfig.hasMaker(sender.toLowerCase())) {
          sendAlert(config, "sender is one of the makers", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
          await setInvalid(config, chainId, txHash, 1);
          continue;
        }

        if (sender.toLowerCase() === "0x6a920c1066a160D2E1667e5d4769D703Ed51c1d4".toLowerCase()) {
          sendAlert(config, "hacker address", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
          await setInvalid(config, chainId, txHash, 5);
          continue;
        }

        const srcLatestBlcok = await srcBackend.getBlockNumber();
        const srcHashBlock = await srcBackend.getTxBlockNumber(txHash);
        if (srcHashBlock === null) {
          sendAlert(config, "source tx not found", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
          continue;
        }
        if (tokenName === "ETH") {
          let waitBlockNumber_eth = srcValueBig > ethers.parseEther("0.5") ? 16 : 2;
          let waitBlockNumber_other = srcValueBig > ethers.parseEther("0.5") ? 20 : 3;
          if (srcChainName === "StarknetMainnet") {
            waitBlockNumber_eth = 1;
            waitBlockNumber_other = 1;
          }
          if (srcChainName === "EthereumMainnet" && srcLatestBlcok - srcHashBlock < waitBlockNumber_eth) {
            utils.log("ignore source tx, block too new EthereumMainnet" + ", tx_hash=" + txHash);
            nextTime = nextTime + srcChainInfo.blockInterval * (waitBlockNumber_eth - (srcLatestBlcok - srcHashBlock));
            await updateNextTime(config, chainId, txHash, nextTime);
            continue;
          } else if (srcLatestBlcok - srcHashBlock < waitBlockNumber_other) {
            utils.log("ignore source tx, block too new, chain=" + srcChainName + ", tx_hash=" + txHash);
            nextTime = nextTime + srcChainInfo.blockInterval * (waitBlockNumber_other - (srcLatestBlcok - srcHashBlock));
            await updateNextTime(config, chainId, txHash, nextTime);
            continue;
          }
        }
       
        // failed for 2 hours, just ignore it
        /*
        if (updateTimestamp.getTime() - insertTimestamp.getTime() > 4 * 60 * 60 * 1000) {
          sendAlert(config, "processed too long", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
          await setInvalid(config, chainId, txHash, 2);
          continue;
        }
        */

        // if dst tx hash already success exceeds.
        if (isSpeedup) {
          let dstTxSuccess: boolean | null = null;
          try {
            dstTxSuccess = await backend.getTxStatus(oldDstTxHash);
          } catch (error) {
            sendAlert(config, "get dst tx status exception when speed up, " + error, srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
            nextTime = (nextTime === 0 ? now + 10 : nextTime + 60 * 5);
            await updateNextTime(config, chainId, txHash, nextTime);
            continue;
          }
          if (dstTxSuccess === true) {
            if (!dstChainName.startsWith("Starknet")) {
              sendAlert(config, "dst tx already success when speed up", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
            }
            await markDstTxVerified(config, oldDstChainId, oldDstTxHash);
            continue;
          }
        }
        if (isSpeedup === true) {
          sendAlert(config, "speed up tx", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
        }

        // fetch transaction receipt
        const txStatus = await srcBackend.getTxStatus(txHash);
        if (txStatus === null) {
          utils.log("tx not found or waiting, chainid=" + chainId + ", tx_hash=" + txHash);
          nextTime = (nextTime === 0 ? now + 10 : nextTime + 10);
          await updateNextTime(config, chainId, txHash, nextTime);
          continue;
        } else if (txStatus !== true) {
          sendAlert(config, "ignore source tx, status == 0", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
          await setInvalid(config, chainId, txHash, 3);
          continue;
        }


        const lp = await getLpInfo(config, tokenName, srcChainName, dstChainName, maker);
        if (lp === null) {
          sendAlert(config, "lp not found", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
          await setInvalid(config, chainId, txHash, 13);
          continue;
        }

        const txFeeRatio = 0n;

        const dynamic_dtc = await config.online_db.t_dynamic_dtc.findUnique({    
          where: {
            token_name_from_chain_to_chain: {
              token_name: tokenName,
              from_chain: srcChainName,
              to_chain: dstChainName,
            },
          }
        });
        if (dynamic_dtc === null) {
          sendAlert(config, "dynamic dtc not found", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
          await setInvalid(config, chainId, txHash, 13);
          continue;
        }
        const gasCompensation = getDynamicDtc(dynamic_dtc, srcValue, tokenDecimal, dstTokenInfo.decimal);

        const [dstValue, bridgeFee] = computeDstValue(srcValue, txFeeRatio, gasCompensation, dstChainId, tokenDecimal, dstTokenInfo.decimal);
        utils.log("tokenName is", tokenName);
        utils.log("srcValue is", ethers.formatUnits(BigInt(srcValue), tokenDecimal));
        utils.log("gasCompensation is", ethers.formatUnits(gasCompensation, tokenDecimal));
        utils.log("dstValue is", ethers.formatUnits(dstValue, tokenDecimal));

        if (dstValue < 0) {
          sendAlert(config, "transfer value too small", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
          await setInvalid(config, chainId, txHash, 6);
          continue;
        }

        //const balance = await dstProvider.getBalance(maker);
        //utils.log("current balance is", ethers.formatEther(balance));

        let dstMaker: string;
        if (dstChainName.startsWith("Starknet")) {
          dstMaker = config.starknetMakerConfig.getMakerAddress(config.env);;
        } else {
          dstMaker = config.makerConfig.getMakerAddress(config.env);;
        }

        nonceKey = dstChainId + "_" + dstMaker.toLowerCase();
        utils.log("nonceKey is", nonceKey);

        let nonce: number;
        if (isSpeedup) { // speed tx using existed nonce
          nonce = oldDstNonce;
          utils.log("nonce (use old) is", nonce);
          nonceMap.delete(nonceKey);
        } else {
          nonce = await getNonce(config, backend, dstMaker, nonceKey, nonceMap);
        }

        const watchFlag = await getWatchFlag(config);
        if (watchFlag !== 0) {
          utils.log("watch flag is not zero, flag=" + watchFlag);
          continue;
        }

        const dstUserAddress = getDstUserAddress(srcChainInfo, dstChainInfo, sender, targetAddress);
        if (dstUserAddress === null) {
          sendAlert(config, "dstUserAddress is null", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
          await setInvalid(config, chainId, txHash, 18);
          continue;
        }
        if (dstUserAddress === "0x0000000000000000000000000000000000000000000000000000000000000000") {
          sendAlert(config, "dstUserAddress is zero address", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
          await setInvalid(config, chainId, txHash, 18);
          continue;
        }

        // estimate gas
        let estimatedGas: bigint;
        try {
          if (dstTokenInfo.address == ethers.ZeroAddress) {
				    estimatedGas = await backend.estimateNativeTransferGas(dstUserAddress, dstValue)
			    } else {
            utils.log("token address:", dstTokenInfo.address);
            utils.log("dstUserAddress:", dstUserAddress);
            utils.log("dstValue:", dstValue);
				    estimatedGas = await backend.estimateERC20TransferGas(dstTokenInfo.address, dstUserAddress, dstValue)
			    }
        } catch (error) {
          const anyError = error as any;
          if ("reason" in anyError) {
            if (anyError["reason"] === "ERC20: transfer amount exceeds balance") {
              const nextTime = secondsLater(10 * 60);
              await setUnlockWithNextTime(config, chainId, txHash, nextTime);
              sendAlert(config, "maker fund is not enough, try later. " + error, srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
              continue;
            } else if (dstChainName.startsWith("Zeta")) {
              sendAlert(config, "Zeta estimate error", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
              await setInvalid(config, chainId, txHash, 19);
              continue;
            } else {
              throw error;
            }
          } else if ("code" in anyError) {
            if (anyError["code"] === "INSUFFICIENT_FUNDS") {
              const nextTime = secondsLater(10 * 60);
              await setUnlockWithNextTime(config, chainId, txHash, nextTime);
              sendAlert(config, "maker fund is not enough, try later. " + error, srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
              continue;
            } else {
              throw error;
            }
          } else {
            throw error;
          }
        }

        const gasPrice = await backend.estimateGasPrice({
          isSpeedUp: isSpeedup,
          oldGasPrice: oldDstEstimatedGasPrice,
          oldMaxPriorityFeePerGas: oldDstEstimatedGasPrice,
          oldMaxFeePerGas: oldDstMaxFeePerGas,
        }, estimatedGas, dstTokenInfo.address == ethers.ZeroAddress);

        if (dstChainName !== "LineaMainnet") {
          const gasTooHigh = await isGasTooHigh(dstChainId, backend, tokenInfo, estimatedGas, gasPrice, dstTokenInfo, gasCompensation);
          if (gasTooHigh) {
            sendAlert(config, "delay, gas is too high", srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
            const nextTimeTmp = addNextTime(nextTime, 10 * 60);
            await updateNextTime(config, chainId, txHash, nextTimeTmp);
            continue;
          }
        }
        // mark is_locked before send transaction
        await Lock(config, chainId, txHash);

        let rspTx: SendTransactionResult
        try {
			    if (dstTokenInfo.address == ethers.ZeroAddress) {
				    rspTx = await backend.sendNativeTransfer({
					    to: dstUserAddress,
					    value: dstValue,
					    gasLimit: estimatedGas,
					    nonce: nonce,
					    gasPrice: gasPrice,
				    });
          } else {
				    rspTx = await backend.sendERC20Transfer({
					    tokenAddress: dstTokenInfo.address,
					    recipient: dstUserAddress,
					    value: dstValue,
					    gasLimit: estimatedGas,
					    nonce: nonce,
              gasPrice: gasPrice,
				    });
          }
        } catch (error) {
          utils.log("transfer expcetion, chainid=" + chainId + ", tx_hash=" + txHash + ", error=" + error);
          if (error instanceof Error) {
            if (error.message.includes("code=REPLACEMENT_UNDERPRICED")) {
              sendAlert(config, "replacement underpriced, " + error, srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
              if (isSpeedup) {
                await setDstEstimatedGasPriceAndUnlock(config, chainId, txHash, gasPrice.gasPrice, gasPrice.maxFeePerGas || BigInt(0));
              } else {
                await Unlock(config, chainId, txHash);
                throw error;
              }
            } else if (error.message.includes("code=NONCE_") || error.message.includes("nonce too low")) { // nonce expired, retry
              if (isSpeedup) { // tx to speed is already success, but not indexed in node
                const nextTime = secondsLater(5 * 60);
                await setUnlockWithNextTime(config, chainId, txHash, nextTime);
                sendAlert(config, "speed up tx is probably successed, try next time" + error, srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
              } else {
                await Unlock(config, chainId, txHash);
                throw error;
              }
            } else if (dstChainName.startsWith("Bnb") && error.message.includes("transaction underpriced")) {
              if (isSpeedup) {
                await setDstEstimatedGasPriceAndUnlock(config, chainId, txHash, gasPrice.gasPrice, gasPrice.maxFeePerGas || BigInt(0));
              } else {
                await Unlock(config, chainId, txHash);
                throw error;
              }
            } else if (isInsufficientFundsError(dstChainInfo, error.message)) {
              const nextTime = secondsLater(10 * 60);
              await setUnlockWithNextTime(config, chainId, txHash, nextTime);
              sendAlert(config, "maker fund is not enough, try later. " + error, srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
            } else if (error.message.includes("mempool is full")) {
              const nextTime = secondsLater(30 * 60);
              await setUnlockWithNextTime(config, chainId, txHash, nextTime);
              sendAlert(config, "mempool is full, try next time" + error, srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
            } else if (dstChainName.startsWith("Starknet") && error.message.includes("Invalid transaction nonce")) {
              await Unlock(config, chainId, txHash);
              throw error;
            } else if (dstChainName.startsWith("Zeta") && error.message.includes("invalid nonce")) {
              await Unlock(config, chainId, txHash);
              throw error;
            } else if (isRetryableError(dstChainInfo, error.message)) {
              const nextTime = Math.floor(Date.now() / 1000) + 5 * 60;
              await setUnlockWithNextTime(config, chainId, txHash, nextTime);
            } else if (error.message.includes("\"message\": \"already known\"")) { // tx_hash still in memory pool
              await Unlock(config, chainId, txHash);
              throw error;
            } else if (error.message.includes("request failed or timed out")) {
              sendAlert(config, "rpc request timeout, " + error, srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
              await setInvalidAndUnlock(config, chainId, txHash, 10);
            } else {
              sendAlert(config, "send tx failed, " + error, srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
              await setInvalidAndUnlock(config, chainId, txHash, 7);
            }
          } else {
            sendAlert(config, "send tx failed, not type error, " + error, srcIsTestnet, srcChainName, dstChainName, tokenName, srcValueStr, txHash);
            await setInvalidAndUnlock(config, chainId, txHash, 7);
          }
          continue;
        }

        await setProcessedAndUnlock(
          config, isSpeedup,
          chainId, txHash,
          dstChainId, rspTx.hash.toLowerCase(), nonce,
          gasTokenInfo, dstTokenInfo, estimatedGas, gasPrice.gasPrice, gasPrice.maxFeePerGas || BigInt(-1),
          dstValue.toString(), bridgeFee.toString()
        );

        if (!isSpeedup) {
          nonceMap.set(nonceKey, nonce + 1);
        }
        await updateShardTime(config);
        utils.log(chainId, "[", dstMaker, "->", dstUserAddress, "]", dstChainId, tokenName, ethers.formatUnits(dstValue, tokenDecimal));
      } catch (error) {
        nonceMap.delete(nonceKey);
        utils.log(error);
      }
    }
  }
}

main()
  .then(()=>process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
