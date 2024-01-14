
import { ethers } from "ethers";
import axios from "axios";
import { NewSrcSyncRecord, NewDstSyncRecord } from "../bin/type.js";
import * as utils from "../utils/index.js";
import {
	Backend, NativeTransferRequest,
	ERC20TransferRequest, SendTransactionResult,ApproveERC20Request,
	GasPriceResult, GasPriceRequest, TxReceipt, TxFee,
} from "./types.js";
import { Config, EthersConfig, getEthersConfig } from "./config.js";
import { constructBlockRange } from "./common.js";
import { isValidCrossChainSrcTxV2, isValidDstTx } from "../bin/validate.js";

function isPreEIP1559(chainInfo: utils.ChainInfo): boolean {
  if (chainInfo.name.startsWith("Zkfair") || chainInfo.name.startsWith("OkxX1")) {
    return true;
  }
  return false;
}

function throwDataError(data: any, otherMessage: string) {
  if ("error" in data && "message" in data["error"]) {
    throw new Error(data["error"]["message"]);
  } else {
    throw new Error(otherMessage);
  }
}

export class EvmJsonBackend implements Backend {

  config: Config;
  chainInfo: utils.ChainInfo;
  rpcUrl: string;
  networkName: string;
  ethersConfig: EthersConfig;
  transferContractAddress?: string;

  constructor(config: Config, chainInfo: utils.ChainInfo, ethersConfig: EthersConfig) {
    this.config = config;
    this.chainInfo = chainInfo;
    this.rpcUrl = chainInfo.rpcUrl;
    this.networkName = chainInfo.name;
    this.ethersConfig = ethersConfig;
    this.transferContractAddress = chainInfo.transferContractAddress;
  }

  async setup(): Promise<void> {
  }

  async getBlockNumber(): Promise<number> { 
    const body = {
      jsonrpc: "2.0",
      method: "eth_blockNumber",
      params: [],
    }
    const rsp = await axios.post(this.rpcUrl, body);
    if (rsp.status != 200) {
      throw new Error("get block number failed for " + this.networkName);
    }
    const data = rsp.data;
    if (!("result" in data)) {
      throwDataError(data, "response format error get block number failed for " + this.networkName);
    }
    if (data.result === null) {
      throwDataError(data, "result is null while getBlockNumber for " + this.networkName);
    }

    const blockNumber = parseInt(data.result, 16);
    return blockNumber;
  }

  async getBaseFee(block: string | number): Promise<bigint | null> {
    if (isPreEIP1559(this.chainInfo)) {
      return null;
    } else {
      throw new Error(`getBaseFee not supported on ${this.networkName}`);
    }
  }

	async getSrcERC20SyncRecords(fromBlockNumber: number, toBlockNumber: number, gappedBlockNumber: number | null): Promise<NewSrcSyncRecord[]> {
    const network = this.config.networkConfig.get(this.networkName)!;
    const logs = await getLogsByBlock(true, this.config, this.ethersConfig, this.networkName, fromBlockNumber, toBlockNumber, this.rpcUrl, this.transferContractAddress);
    if (gappedBlockNumber !== null && (gappedBlockNumber < fromBlockNumber || gappedBlockNumber > toBlockNumber)) {
		  const logs1 = await getLogsByBlock(true, this.config, this.ethersConfig, this.networkName, gappedBlockNumber, gappedBlockNumber, this.rpcUrl, this.transferContractAddress);
      logs.push(...logs1);
    }
		return constructSrcERC20Records(this.networkName, this.config, this.ethersConfig, network, logs, this.rpcUrl, this.transferContractAddress);
  }

	async getSrcNativeSyncRecords(fromBlockNumber: number, toBlockNumber: number, gappedBlockNumbers: number[], skipBlocks: Array<number>): Promise<NewSrcSyncRecord[]> {
		const chain = this.config.chainConfig.getChainInfoByName(this.networkName);

		// get gapped block
		const range = constructBlockRange(fromBlockNumber, toBlockNumber, gappedBlockNumbers);
    const batchOfTransactions = await Promise.all(
			range.map((blockNumber) => getSrcTransactionsByBlock(this.config, chain, blockNumber, skipBlocks, this.rpcUrl))
		);
		return constructSrcNativeRecords(this.config, chain, batchOfTransactions.flat());

  }

	async getDstERC20SyncRecords(fromBlockNumber: number, toBlockNumber: number): Promise<NewDstSyncRecord[]> {
		const network = this.config.networkConfig.get(this.networkName)!;
		const logs = await getLogsByBlock(false, this.config, this.ethersConfig, this.networkName, fromBlockNumber, toBlockNumber, this.rpcUrl);
		return constructDstERC20Records(this.networkName, this.config, this.ethersConfig, network, logs, this.rpcUrl);

  }

	async getDstNativeSyncRecords(fromBlockNumber: number, toBlockNumber: number, lastSkipBlockNumbers: number[], skipBlocks: Array<number>): Promise<NewDstSyncRecord[]> {
		const network = this.config.networkConfig.get(this.networkName)!;

		const chain = this.config.chainConfig.getChainInfoByName(this.networkName);

		const range = constructBlockRange(fromBlockNumber, toBlockNumber, lastSkipBlockNumbers);
		const batchOfTransactions = await Promise.all(
			range.map((blockNumber) => getDstTransactionsByBlock(this.config, chain, blockNumber, skipBlocks, this.rpcUrl))
		);
		return constructDstNativeRecords(this.config, network, batchOfTransactions.flat());
  }

	async getTxStatus(txHash: string): Promise<boolean | null> {
    const body = {
      jsonrpc: "2.0",
      method: "eth_getTransactionReceipt",
      params: [txHash],
    }
    const rsp = await axios.post(this.rpcUrl, body);
    if (rsp.status != 200) {
      throw new Error("get tx status failed for " + this.networkName);
    }
    const data = rsp.data;
    if (!("result" in data)) {
      throwDataError(data, "response format error get tx status failed for " + this.networkName);
    }
    if (data.result === null) {
      throwDataError(data, "data.result is null while getTxStatus for " + this.networkName);
    }
    const result = data.result;

    if (!("status" in result)) {
      throw new Error("result.status not found while getTxStatus for " + this.networkName);
    }

    if (result.status === null) {
      throw new Error(`result.status is null while getTxStatus for " + ${this.networkName}`);
    }

    return data.result.status === "0x1";
  }

	async getTxFee(txHash: string): Promise<TxFee> {
    const receipt = await this.getTxReceipt(txHash);
		if (receipt === null) {
			return { gasUsed: null, gasPrice: null, fee: null };
		}

		return receipt.fee;
  }

	async getTxReceipt(txHash: string): Promise<TxReceipt | null> {
    const body = {
      jsonrpc: "2.0",
      method: "eth_getTransactionReceipt",
      params: [txHash],
    }
    const rsp = await axios.post(this.rpcUrl, body);
    if (rsp.status != 200) {
      throw new Error("get tx Receipt failed for " + this.networkName);
    }

    if (!("data" in rsp)) {
      throw new Error("get tx Receipt data format error for " + this.networkName);
    }
    const data = rsp.data;

    if (!("result" in data)) {
      throwDataError(data, "response format error get tx Receipt failed for " + this.networkName);
    }
    const result = data.result;
    if (result === null) {
      throwDataError(data, "response format error, result is null, get tx Receipt failed for " + this.networkName);
    }

    if (!("status" in result) || !("gasUsed" in result) || !("effectiveGasPrice" in result)) {
      throw new Error("essential fields not exist for get tx Receipt on " + this.networkName);
    }

    const status = parseInt(result.status, 16);
    const gasUsed = BigInt(result.gasUsed);
    const gasPrice = BigInt(result.effectiveGasPrice);
    const fee = gasUsed * gasPrice;

		return {
			status: status,
			fee: {
				gasUsed: gasUsed,
				gasPrice: gasPrice,
				fee: fee,
			},
		}
  }

	async getTxNonce(txHash: string): Promise<number | null> {
    const body = {
      jsonrpc: "2.0",
      method: "eth_getTransactionByHash",
      params: [txHash],  // Add the address parameter and block parameter
    };

    const rsp = await axios.post(this.rpcUrl, body);
  
    if (rsp.status !== 200) {
      throw new Error(`Failed to get tx nonce for ${this.networkName}`);
    }
  
    const data = rsp.data;

    if (!("result" in data)) {
      throwDataError(data, `data.result not found while getTxNonce for ${this.networkName}`);
    }
    const result = data.result;

    if (result === null) {
      throwDataError(data, `data.result is null in getTxNonce for ${this.networkName}`);
    }
    if (!("nonce" in result)) {
      throwDataError(data, `result.nonce not found in getTxNonce for ${this.networkName}`);
    }
    if (result.nonce === null) {
      throwDataError(data, `result.nonce is null in getTxNonce for ${this.networkName}`);
    }
    const nonce = parseInt(result.nonce, 16);

    return nonce;
  }
	
	async getTxBlockNumber(txHash: string): Promise<number | null> {
    const body = {
      jsonrpc: "2.0",
      method: "eth_getTransactionByHash",
      params: [txHash],  // Add the address parameter and block parameter
    };

    const rsp = await axios.post(this.rpcUrl, body);
  
    if (rsp.status !== 200) {
      throw new Error(`Failed to get tx nonce for ${this.networkName}`);
    }
  
    const data = rsp.data;

    if (!("result" in data)) {
      throw new Error(`Response format error while get tx nonce for ${this.networkName}`);
    }
  
    const transaction = data.result;
    const blockNumber = parseInt(transaction.blockNumber, 16);

    return blockNumber;
  }
	
  async getERC20Balance(address: string, tokenAddress: string): Promise<bigint> {
    const calldata = this.ethersConfig.erc20Interface.encodeFunctionData("balanceOf", [address]);

    const body = {
      jsonrpc: "2.0",
      method: "eth_call",
      params: [{
        to: tokenAddress,
        data: calldata,
      }, "latest"],
    }
    const rsp = await axios.post(this.rpcUrl, body);
    if (rsp.status != 200) {
      throw new Error("get getERC20Balance for " + this.networkName);
    }
    const data = rsp.data;
    if (!("result" in data)) {
      throwDataError(data, "data.result not found while getERC20Balance for " + this.networkName);
    }
    if (data.result === null) {
      throwDataError(data, "data.result is null while getERC20Balance for " + this.networkName);
    }
    
    const balance = BigInt(data.result);
    return balance;
  }

	async getNativeBalance(address: string): Promise<bigint> {
    const body = {
      jsonrpc: "2.0",
      method: "eth_getBalance",
      params: [address, "latest"],
    }
    const rsp = await axios.post(this.rpcUrl, body);
    if (rsp.status != 200) {
      throw new Error(`status=${rsp.status} while getNativeBalance for ${this.networkName}`);
    }
    const data = rsp.data;
    if (!("result" in data)) {
      throwDataError(data, `data.result not found while getNativeBalance for ${this.networkName}`);
    }
    if (data.result === null) {
      throwDataError(data, `data.result is null while getNativeBalance for ${this.networkName}`);
    }

    const balance = BigInt(data.result);
    return balance;
  }

	async getBalance(address: string, token: utils.TokenInfo): Promise<bigint> {
    if (token.address === ethers.ZeroAddress) {
      return this.getNativeBalance(address);
    } else {
      return this.getERC20Balance(address, token.address);
    }
  }

	async getNonce(address: string): Promise<number> {
    const body = {
      jsonrpc: "2.0",
      method: "eth_getTransactionCount",
      params: [address, "latest"],  // Add the address parameter and block parameter
    };
  
    const rsp = await axios.post(this.rpcUrl, body);

    if (rsp.status !== 200) {
      throw new Error(`Failed to get nonce for ${this.networkName}`);
    }
  
    const data = rsp.data;

    if (!("result" in data)) {
      throwDataError(data, `data.result not found while getNonce for ${this.networkName}`);
    }
    if (data.result === null) {
      throwDataError(data, `data.result is null while getNonce for ${this.networkName}`);
    }

    const nonce = parseInt(data.result, 16);  // Parse the hexadecimal nonce
  
    return nonce;
  }

	async estimateNativeTransferGas(to: string, value: bigint): Promise<bigint> {
    if (this.networkName.startsWith("Zkfair") || this.networkName.startsWith("OkxX1")) {
      return 21000n;
    } else {
      throw new Error("native gas not supported on" + this.networkName);
    }
  }

	async estimateERC20TransferGas(tokenAddress: string, recipient: string, value: bigint): Promise<bigint> {
    const makerAddress = this.config.makerAddress;
    const params = {
      from: makerAddress,
      to: tokenAddress,
      value: "0x0",
      type: 0x0,
      chainId: this.chainInfo.chainId,
      data: this.ethersConfig.erc20Interface.encodeFunctionData("transfer", [recipient, value]),
    }

    const rsp = await axios.post(this.rpcUrl, {
      jsonrpc: "2.0",
      method: "eth_estimateGas",
      params: [params],
    });

    if (rsp.status !== 200) {
      throw new Error(`Failed to estimate gas for ${this.networkName}`);
    }

    if (!("data" in rsp)) {
      throw new Error(`Failed to estimate gas for ${this.networkName}, no data field`);
    }
    const data = rsp.data;

    if (!("result" in data)) {
      throwDataError(data, `data.result not found while estimateERC20TransferGas for ${this.networkName}`);
    }
    const result = data.result;
    if (result === null) {
      throwDataError(data, `data.result is null while estimateERC20TransferGas for ${this.networkName}`);
    }

    const estimatedGas = BigInt(result);

    return estimatedGas + estimatedGas * 10n / 100n;
  }

	async estimateTransferContractGas(tokenAddress: string, recipient: string, value: bigint): Promise<bigint> {
    throw new Error("not supported on" + this.networkName);
  }

  async estimateApproveERC20Gas(tokenAddress: string, value: bigint): Promise<bigint> {
    throw new Error("not supported on" + this.networkName);
  }


	async getGasPrice(): Promise<GasPriceResult> {
    const body = {
      jsonrpc: "2.0",
      method: "eth_gasPrice",
      params: [],
    }
    const rsp = await axios.post(this.rpcUrl, body);
    if (rsp.status != 200) {
      throw new Error(`eth_gasPrice failed for ${this.networkName}, http is not 200`);
    }
    if (!("data" in rsp)) {
      throw new Error(`eth_gasPrice failed for ${this.networkName}, no data field`);
    }
    const data = rsp.data;

    if (!("result" in data)) {
      throwDataError(data, `data.result not found while getGasPrice for ${this.networkName}`);
    }

    const result = data.result
    if (result === null) {
      throwDataError(data, `data.result is null while getGasPrice for ${this.networkName}`);
    }
    const gasPrice = BigInt(data.result);
    return {
      gasPrice: gasPrice,
      maxFeePerGas: null,
    }
  }

	async estimateGasPrice(req: GasPriceRequest, gasLimit: bigint, isNativeTransfer: boolean): Promise<GasPriceResult> {
    let feeData = await this.getGasPrice();
    let gasPrice = feeData.gasPrice!;
    if (this.networkName === "ZkfairMainnet") {
      gasPrice += gasPrice * 10n / 100n;
    }
   
    let oldGasPrice = req.oldGasPrice;
    let isSpeedUp = req.isSpeedUp
    if (isSpeedUp && oldGasPrice !== null) {
      if (oldGasPrice >= gasPrice) {
          gasPrice = oldGasPrice + oldGasPrice * 15n / 100n; // speed up 15%
      }
    }
    return { gasPrice: gasPrice, maxFeePerGas: null }
  }


	// send native token transfer tx
	async sendNativeTransfer(req: NativeTransferRequest): Promise<SendTransactionResult> {
    if (!isPreEIP1559(this.chainInfo)) {
      throw new Error(`not supported on ${this.networkName}`);
    }

    const makerAddress = this.config.makerAddress;
    const tx: ethers.TransactionRequest = {
      to: req.to,
      value: req.value,
      gasLimit: utils.bigint2Hex(req.gasLimit),
      nonce: req.nonce,
      type: 0x0,
      gasPrice: req.gasPrice.gasPrice,
      chainId: this.chainInfo.chainId,
    }

    const btx = ethers.Transaction.from(tx as ethers.TransactionLike<string>);

    console.log("btx:", btx.toString());
    console.log("btx.unsignedHash:", btx.unsignedHash);
    btx.signature = await this._signDigest(btx.unsignedHash);
    const rawTx = btx.serialized;
    console.log("rawTx:", rawTx);

    const body = {
      jsonrpc: "2.0",
      method: "eth_sendRawTransaction",
      params: [rawTx],
    }

    const rsp = await axios.post(this.rpcUrl, body);
    if (rsp.status != 200) {
      throw new Error(`eth_sendRawTransaction failed for ${this.networkName}, http is not 200`);
    }
    if (!("data" in rsp)) {
      throw new Error(`eth_sendRawTransaction failed for ${this.networkName}, no data field`);
    }
    const data = rsp.data;
    if (!("result" in data)) {
      throwDataError(data, `Response format error while sendRawTransaction for ${this.networkName}`);
    }
    const result = data.result;
    if (result === null) {
      throwDataError(data, `data.result is null while sendRawTransaction for ${this.networkName}`);
    }

    return {
      chainId: this.chainInfo.chainId,
      hash: result.toLowerCase(),
    }
  }
	// send erc20 transfer tx
	async sendERC20Transfer(req: ERC20TransferRequest): Promise<SendTransactionResult> {
    if (!isPreEIP1559(this.chainInfo)) {
      throw new Error(`not supported on ${this.networkName}`);
    }

    const tx: ethers.TransactionRequest = {
      to: req.tokenAddress,
      value: 0x0,
      gasLimit: utils.bigint2Hex(req.gasLimit),
      nonce: req.nonce,
      type: 0x0,
      gasPrice: req.gasPrice.gasPrice,
      chainId: this.chainInfo.chainId,
      data: this.ethersConfig.erc20Interface.encodeFunctionData("transfer", [req.recipient, req.value]),
    }

    const btx = ethers.Transaction.from(tx as ethers.TransactionLike<string>);

    console.log("btx:", btx.toString());
    console.log("btx.unsignedHash:", btx.unsignedHash);
    btx.signature = await this._signDigest(btx.unsignedHash);
    const rawTx = btx.serialized;
    console.log("rawTx:", rawTx);

    const body = {
      jsonrpc: "2.0",
      method: "eth_sendRawTransaction",
      params: [rawTx],
    }

    const rsp = await axios.post(this.rpcUrl, body);
    if (rsp.status != 200) {
      throw new Error(`sendERC20Transfer failed for ${this.networkName}, http is not 200`);
    }
    if (!("data" in rsp)) {
      throw new Error(`sendERC20Transfer failed for ${this.networkName}, no data field`);
    }
    const data = rsp.data;
    if (!("result" in data)) {
      throwDataError(data, `Response format error while sendERC20Transfer for ${this.networkName}`);
    }
    const result = data.result;
    if (result === null) {
      throwDataError(data, `data.result is null while sendERC20Transfer for ${this.networkName}`);
    }

    return {
      chainId: this.chainInfo.chainId,
      hash: result.toLowerCase(),
    }
  }
  // send through TransferContract
	async sendTransferContract(req: ERC20TransferRequest): Promise<SendTransactionResult> {
    throw new Error("not supported on" + this.networkName);
  }
  // send approve erc20 tx
  async approveERC20(req: ApproveERC20Request): Promise<SendTransactionResult> {
    throw new Error("not supported on" + this.networkName);
  }

  async _signDigest(hash: string): Promise<string> {
    const makerAddress = this.config.makerAddress;
    const makerInfo = this.config.makerConfig.getMakerInfoByEnv(this.config.env);

    if (makerInfo.kmsUrl === undefined || makerInfo.kmsAPIKey === undefined) {
      throw new Error(`Failed to sign for ${this.networkName}, no kmsUrl or kmsAPIKey`);
    }

    const kmsApi = makerInfo.kmsUrl + "/sign/eth";
    const rsp = await axios.post<string>(kmsApi, {
      digest: hash,
      address: makerAddress,
    }, {
      auth: {
        username: makerInfo.kmsAPIKey,
        password: "",
      }
    });

    if (rsp.status !== 200) {
      throw new Error(`Failed to sign for ${this.networkName}`);
    }
    if (!("data" in rsp)) {
      throw new Error(`Failed to sign for ${this.networkName}, no data field`);
    }
    return rsp.data;

  }

	async getAllowance(address: string, tokenAddress: string): Promise<bigint> {
    throw new Error("not supported on" + this.networkName);
	}

}

interface transactionResponse {
  from: string;
  to: string;
  value: bigint;
  chainId: number;
  hash: string;
  nonce: number;
}

async function getSrcTransactionsByBlock(
    config: Config,
    chain: utils.ChainInfo,
    blockNumber: number, 
    skipBlocks: Array<number>,
    rpcUrl: string): Promise<Array<transactionResponse>> {

 	const result: Array<transactionResponse> = [];
  try {
    const body = {
      jsonrpc: "2.0",
      method: "eth_getBlockByNumber",
      params: [blockNumber, true],
    }
    const rsp = await axios.post(rpcUrl, body);
    if (rsp.status != 200) {
      throw new Error("getSrcTransactionsByBlock for " + chain.name);
    }
    const data = rsp.data;
    if (!("result" in data)) {
      throwDataError(data, "getSrcTransactionsByBlock failed for " + chain.name);
    }
    if (data.result === null) {
      throwDataError(data, `data.result is null while getSrcTransactionsByBlock for ${chain.name}`);
    }
      
    const block = data.result;
    if (block === null) {
      throwDataError(data, `data.result is null while getSrcTransactionsByBlock for ${chain.name}`);
    }

    if (block.transactions === undefined || block.transactions === null) {
      utils.log("block transactions is null, block number =", blockNumber, "chainid =", chain.chainId);
      return result;
    }
      
    for (const tx of block.transactions) {
      if (tx.chainId === null) { // why would chainId be null?
        continue;
      }
      if (!isValidCrossChainSrcTxV2(
        chain.name,
        config.chainConfig,
        config.makerConfig,
        config.starknetMakerConfig,
        tx.from,
        tx.to,
        config.makerAddress)) {
          continue;
      }

      result.push({
        from: tx.from,
        to: tx.to,
        value: BigInt(tx.value),
        chainId: Number(tx.chainId),
        hash: tx.hash,
        nonce: tx.nonce,
      });
    }
  } catch (error) {
    skipBlocks.push(blockNumber);
    utils.log(error);
  }
	return result;
}

function constructSrcNativeRecords(
	config: Config,
	chain: utils.ChainInfo,
	txs: Array<transactionResponse>): Array<NewSrcSyncRecord> {

	const records: Array<NewSrcSyncRecord> = [];
	for (const item of txs) {
		if (!isValidCrossChainSrcTxV2(
			chain.name,
			config.chainConfig,
			config.makerConfig,
      config.starknetMakerConfig,
			item.from,
			item.to,
			config.makerAddress)) {
			continue;
		}

		const chainId = item.chainId;
		const sender = item.from!;
		// tx had been filtered out if item.to is undefined
		const receiver = item.to as string;
		const value = item.value;

		let dstChainId: number | null;
		try {
			dstChainId = config.chainConfig.getChainIdByValue(value);
		} catch (error) {
			dstChainId = null;
		}

    const isTestnet = config.chainConfig.isTestnetByChainId(chainId);
    const tokenName = config.tokenConfig.getSymbol(chainId, ethers.ZeroAddress); 
    const tokenDecimal = config.tokenConfig.getInfoBySymbolAndChainId(tokenName, chainId).decimal;

		records.push({
			chainid: chainId,
			tx_hash: item.hash,
			src_nonce: Number(item.nonce),
			dst_chainid: dstChainId,
			sender: utils.normalizeAddress(sender),
			receiver: utils.normalizeAddress(receiver),
			token: ethers.ZeroAddress,
			value: value.toString(),
			is_processed: 0,
			is_invalid: 0,
			is_testnet: isTestnet,
			src_token_name: tokenName,
			src_token_decimal: tokenDecimal,
      is_cctp: 0,
		});
	}

	return records;
}

async function getDstTransactionsByBlock(
	config: Config,
	chain: utils.ChainInfo,
	blockNumber: number,
  skipBlocks: Array<number>,
  rpcUrl: string): Promise<Array<transactionResponse>> {

	const result: Array<transactionResponse> = [];
  try {
    const body = {
      jsonrpc: "2.0",
      method: "eth_getBlockByNumber",
      params: [blockNumber, true],
    }
    const rsp = await axios.post(rpcUrl, body);
    if (rsp.status != 200) {
      throw new Error("getDstTransactionsByBlock for " + chain.name);
    }
    const data = rsp.data;
    if (!("result" in data)) {
      throwDataError(data, "getDstTransactionsByBlock failed for " + chain.name);
    }
      
    const block = data.result;
    if (block === null) {
      throw new Error("block is null, block number =" + blockNumber + "chainid =" + chain.chainId);
    }

    if (block.transactions === undefined || block.transactions === null) {
      return result;
    }

    for (const tx of block.transactions) {
      if (!isValidDstTx(
        chain.name,
        config.chainConfig,
        config.makerConfig,
        tx.from,
        tx.to,
        config.makerAddress,
        tx.value)) {
          continue;
        }
        result.push({
          from: tx.from,
          to: tx.to,
          value: BigInt(tx.value),
          chainId: Number(tx.chainId),
          hash: tx.hash,
          nonce: tx.nonce,
        });
    }
  } catch (error) {
    skipBlocks.push(blockNumber);
    utils.log(error);
  }
  return result;
}

function constructDstNativeRecords(
	config: Config,
	network: utils.Network,
	txs: Array<transactionResponse>): Array<NewDstSyncRecord> {

	const records: Array<NewDstSyncRecord> = [];
	for (const item of txs) {
		const sender = item.from!;
		const receiver = item.to as string;
		const value = item.value;
		records.push({
			sender: utils.normalizeAddress(sender),
			receiver: utils.normalizeAddress(receiver),
			value: value.toString(),
			dst_chainid: Number(item.chainId),
			dst_nonce: Number(item.nonce),
			dst_tx_hash: item.hash,
			is_verified: 1,
		});
	}

	return records;
}


interface logResponse {
  transactionHash: string;
  topics: Array<string>;
  address: string;
  data: string;
}

async function getLogsByBlock(
  isSrc: boolean,
	config: Config,
	ethersConfig: EthersConfig,
	networkName: string,
	fromBlockNumber: number,
	toBlockNumber: number,
  rpcUrl: string,
  transferContractAddress?: string) {

  let logs: Array<logResponse> = [];
  if (isSrc && transferContractAddress !== undefined) {
    const body = {
      jsonrpc: "2.0",
      method: "eth_getLogs",
      params: [{
        fromBlock: fromBlockNumber,
        toBlock: toBlockNumber,
        address: transferContractAddress,
        topics: [ethersConfig.transferContractSignature],
      }],
    }
    const rsp = await axios.post(rpcUrl, body);
    if (rsp.status != 200) {
      throw new Error("get LogsByBlock transferContractAddress for " + networkName);
    }
    const data = rsp.data;
    if (!("result" in data)) {
      throwDataError(data, "get LogsByBlock transferContractAddress failed for " + networkName);
    }
    if (data.result === null) {
      throwDataError(data, "data.result is null while LogsByBlock transferContractAddress failed for " + networkName);
    }
      
    const logstransferContract = rsp.data.result;
    logstransferContract.forEach((logitem: any) => {
      logs.push({
        transactionHash: logitem.transactionHash,
        topics: logitem.topics,
        address: logitem.address,
        data: logitem.data,
      });
    });
  }

  const body = {
    jsonrpc: "2.0",
    method: "eth_getLogs",
    params: [{
      fromBlock: fromBlockNumber.toString(),
      toBlock: toBlockNumber.toString(),
      address: config.tokenConfig.getErc20AddressesByNetworkName(networkName),
      topics: [ethersConfig.erc20TransferSignature],
    }],
  }
  const rsp = await axios.post(rpcUrl, body);
  if (rsp.status != 200) {
    throw new Error("get LogsByBlock erc20 for " + networkName);
  }
  const data = rsp.data;
  if (!("result" in data)) {
    throwDataError(data, "get LogsByBlock erc20 failed for " + networkName);
  }
  if (data.result === null) {
    throwDataError(data, "data.result is null while LogsByBlock erc20 failed for " + networkName);
  }

  const logsERC20 = rsp.data.result;
  logsERC20.forEach((logitem: any) => {
    logs.push({
        transactionHash: logitem.transactionHash,
        topics: logitem.topics,
        address: logitem.address,
        data: logitem.data,
    });
  });

  return logs;
}

async function constructSrcERC20Records(
	networkName: string,
	config: Config,
	ethersConfig: EthersConfig,
	chain: utils.Network,
	logs: Array<logResponse>,
  rpcUrl: string,
  transferContractAddress?: string,
): Promise<Array<NewSrcSyncRecord>> {
	const records: Array<NewSrcSyncRecord> = [];
	for (const log of logs) {
		const chainId = chain.chainId;
		const txHash = log.transactionHash;
		const topics = log.topics;
		const sender = ethersConfig.abi.decode(["address"], topics[1])[0];
		let receiver = ethersConfig.abi.decode(["address"], topics[2])[0];
    let token = utils.normalizeAddress(log.address);
    let value: bigint;
    let target: string | undefined = undefined;
    if (transferContractAddress !== undefined &&
        log.address.toLowerCase() === transferContractAddress.toLowerCase()) {
      token = utils.normalizeAddress(ethersConfig.abi.decode(["address"], topics[2])[0]);
      receiver = ethersConfig.abi.decode(["address"], topics[3])[0].toLowerCase();
      const decodeData = ethersConfig.abi.decode(["string", "uint256", "uint256"], log.data);
      target = utils.normalizeAddress(decodeData[0].toLowerCase());
      value = decodeData[1];
    } else {
		  value = ethersConfig.abi.decode(["uint256"], log.data)[0];
    }


		if (!isValidCrossChainSrcTxV2(
			networkName,
			config.chainConfig,
			config.makerConfig,
      config.starknetMakerConfig,
			sender,
			receiver,
			config.makerAddress)) {
			continue;
		}

		utils.log("chainid=" + chainId + ", txHash=" + txHash + ", sender=" + sender + ", receiver=" + receiver + ", value=" + value);

		let src_nonce = -1;
		try {
      const body = {
        jsonrpc: "2.0",
        method: "eth_getTransactionByHash",
        params: [txHash],
      }
      const rsp = await axios.post(rpcUrl, body);
      if (rsp.status != 200) {
        throw new Error("get constructSrcERC20Records for " + networkName);
      }
      const data = rsp.data;
      if (!("result" in data)) {
        throwDataError(data, "get constructSrcERC20Records failed for " + networkName);
      }
      if (data.result === null) {
        throwDataError(data, "data.result is null constructSrcERC20Records failed for " + networkName);
      }
      const txInfo = rsp.data.result;
			if (txInfo !== undefined && txInfo !== null) {
				src_nonce = Number(txInfo.nonce);
			}
		} catch (error) {
			utils.log("getTransaction failed, txHash=" + txHash);
			continue;
		}

		let dstChainId: number | null = null;
		try {
			dstChainId = config.chainConfig.getChainIdByValue(value);
		} catch (error) {
			utils.log("value has no valid network code, chainId=" + chainId + ", sender=" + sender);
		}
		const isTestnet = config.chainConfig.isTestnetByChainId(chainId);
		const tokenInfo = config.tokenConfig.getInfoByChainIdAndAddress(chainId, token);
		const tokenName = tokenInfo.symbol;
		const tokenDecimal = tokenInfo.decimal;
    let is_cctp = 0;
    if (tokenName === "USDC" && dstChainId !== null) {
      const min_value = await config.db.t_cctp_support_chain.findUnique({
        select: {
          min_value: true,
        },
        where: {
          chainid: dstChainId,
        },
      });
      const src_cctp = await config.db.t_cctp_support_chain.findUnique({
        where: {
          chainid: chainId,
        },
      });
      if (src_cctp !== null && min_value !== null && value >= ethers.parseUnits(min_value.min_value, tokenDecimal)) {
        is_cctp = 1;
        utils.alertCCTP(config.env, "new CCTP tx " + txHash + ", chainId=" + chainId + ", value=" + value);
      }
    }
		records.push({
			chainid: chainId,
			tx_hash: txHash,
			src_nonce: src_nonce,
			dst_chainid: dstChainId,
			sender: utils.normalizeAddress(sender),
			receiver: utils.normalizeAddress(receiver),
      target_address: target,
			token: token,
			value: value.toString(),
			is_processed: 0,
			is_invalid: 0,
			is_testnet: isTestnet,
			src_token_name: tokenName,
			src_token_decimal: tokenDecimal,
      is_cctp: is_cctp,
		});
	}

	return records;
}

async function constructDstERC20Records(
	networkName: string,
	config: Config,
	ethersConfig: EthersConfig,
	network: utils.Network,
	logs: Array<logResponse>,
  rpcUrl: string): Promise<Array<NewDstSyncRecord>> {

	const records: Array<NewDstSyncRecord> = [];
	for (const log of logs) {
		const chainId = network.chainId;
		const topics = log.topics;

		const sender = ethersConfig.abi.decode(["address"], topics[1])[0];
		const receiver = ethersConfig.abi.decode(["address"], topics[2])[0];
		const value = ethersConfig.abi.decode(["uint256"], log.data)[0];

		const txHash = log.transactionHash;

		if (!isValidDstTx(
			networkName,
			config.chainConfig,
			config.makerConfig,
			sender,
			receiver,
			config.makerAddress,
			value)) {
			continue;
		}

		let dst_nonce: number;
		try {
      const body = {
        jsonrpc: "2.0",
        method: "eth_getTransactionByHash",
        params: [txHash],
      }
      const rsp = await axios.post(rpcUrl, body);
      if (rsp.status != 200) {
        throw new Error("get constructDstERC20Records for " + networkName);
      }
      const data = rsp.data;
      if (!("result" in data)) {
        throwDataError(data, "get constructDstERC20Records failed for " + networkName);
      }
      if (data.result === null) {
        throwDataError(data, "data.result is null while constructDstERC20Records for " + networkName);
      }
      const txInfo = rsp.data.result;
			if (txInfo === undefined || txInfo === null) {
				utils.log("getTransaction failed, txHash=" + txHash);
				continue;
			} else {
				dst_nonce = Number(txInfo.nonce);
			}
		} catch (error) {
			utils.log("getTransaction failed, txHash=" + txHash);
			continue;
		}


		records.push({
			sender: utils.normalizeAddress(sender),
			receiver: utils.normalizeAddress(receiver),
			value: value.toString(),
			dst_chainid: chainId,
			dst_nonce: dst_nonce,
			dst_tx_hash: txHash,
			is_verified: 1,
		});
	}

	return records;
}
