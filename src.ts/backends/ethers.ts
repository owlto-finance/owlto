import { ethers } from "ethers";
import { promises as fs } from "fs";
import * as utils from "../utils/index.js";
import {
	Backend, NativeTransferRequest,ApproveERC20Request,
	ERC20TransferRequest, SendTransactionResult,
	GasPriceResult, GasPriceRequest, TxReceipt, TxFee,
} from "./types.js";
import { NewSrcSyncRecord, NewDstSyncRecord } from "../bin/type.js";
import { isValidCrossChainSrcTxV2, isValidDstTx } from "../bin/validate.js";
import { Config, EthersConfig, getEthersConfig } from "./config.js";
import { constructBlockRange } from "./common.js";

interface WalletAndTimestamp {
	signer: ethers.AbstractSigner,
	timestamp: number, // cache duaraion
}

interface ProviderAndTimestamp {
	provider: ethers.Provider,
	timestamp: number, // cache duration
}

export class EthersBackend implements Backend {
	config: Config;
	ethersConfig: EthersConfig;
	provider: ethers.Provider;
	networkName: string;
  chainId: number;
  chainInfo: utils.ChainInfo;
  privateKey?: string;
  testAddress?: string;
  transferContractAddress?: string;

	// cache providers and wallets
	static walletByName = new Map<string, WalletAndTimestamp>();
	static providerByName = new Map<string, ProviderAndTimestamp>();

	constructor(config: Config, networkName: string, ethersConfig: EthersConfig, privateKey?: string) {
    const chainInfo = config.chainConfig.getChainInfoByName(networkName);
		this.config = config;
		this.networkName = networkName;
    this.chainId = chainInfo.chainId; 
    this.chainInfo = chainInfo;
		this.ethersConfig = ethersConfig;
    this.privateKey = privateKey;
    if (privateKey !== undefined) {
      this.testAddress = utils.privateKeyToAddress(privateKey);
    }
		this.provider = this.getProviderByName(networkName);
    this.transferContractAddress = chainInfo.transferContractAddress;
	}

	async setup(): Promise<void> {
	}

	getProviderByName(name: string): ethers.Provider {
		const now = Math.floor(Date.now() / 1000);
		if (EthersBackend.providerByName.has(name)) {
			const result: ProviderAndTimestamp = EthersBackend.providerByName.get(name)!;
			return result.provider;
		}

		const info = this.config.chainConfig.chainInfos.get(name);
		if (info === undefined) {
			throw new Error("unsupported network, name=" + name);
		}

		const provider = new ethers.JsonRpcProvider(info.rpcUrl);
		EthersBackend.providerByName.set(name, {provider: provider, timestamp: now});

		return provider;
	}

	getWalletByName(name: string, env: string): ethers.AbstractSigner {
		const now = Math.floor(Date.now() / 1000);
		// get from cache first.
		const key = name + "_" + env;
		const result = EthersBackend.walletByName.get(key);
		if (result !== undefined) {
			return result.signer;
		}

		const provider = this.getProviderByName(name);
		const signer = this.config.chainConfig.makerConfig.getEthersSigner(env, provider);
		EthersBackend.walletByName.set(key, {signer: signer, timestamp: now});
		return signer;
	}

	getWalletFor(privateKey: string, networkName: string): ethers.AbstractSigner {
		const provider = this.getProviderByName(networkName);
		return new ethers.Wallet(privateKey, provider);
	}

	async getBlockNumber(): Promise<number> {
		return await this.provider.getBlockNumber();
	}

	async getBaseFee(blockTag: string | number): Promise<bigint | null> {
		const block = await this.provider.getBlock(blockTag);
		if (block === null) {
			return null
		}
		return block.baseFeePerGas;
	}

  async getSrcERC20SyncRecords(fromBlockNumber: number, toBlockNumber: number, gappedBlockNumber: number | null): Promise<NewSrcSyncRecord[]> {
    const network = this.config.networkConfig.get(this.networkName)!;
    const logs = await getLogsByBlock(true, this.config, this.ethersConfig, this.networkName, this.provider, fromBlockNumber, toBlockNumber, this.transferContractAddress);
    if (gappedBlockNumber !== null && (gappedBlockNumber < fromBlockNumber || gappedBlockNumber > toBlockNumber)) {
		  const logs1 = await getLogsByBlock(true, this.config, this.ethersConfig, this.networkName, this.provider, gappedBlockNumber, gappedBlockNumber, this.transferContractAddress);
      logs.push(...logs1);
    }
		return constructERC20Records(this.networkName, this.config, this.ethersConfig, this.provider, network, logs, this.transferContractAddress);
	}

	async getSrcNativeSyncRecords(fromBlockNumber: number, toBlockNumber: number, gappedBlockNumbers: number[], skipBlocks: Array<number>): Promise<NewSrcSyncRecord[]> {
		const chain = this.config.chainConfig.getChainInfoByName(this.networkName);

		// get gapped block
		const range = constructBlockRange(fromBlockNumber, toBlockNumber, gappedBlockNumbers);
    const batchOfTransactions = await Promise.all(
			range.map((blockNumber) => getSrcTransactionsByBlock(this.config, this.provider, chain, blockNumber, skipBlocks))
		);
		return constructSrcNativeRecords(this.config, chain, batchOfTransactions.flat());
	}

	async getDstERC20SyncRecords(fromBlockNumber: number, toBlockNumber: number): Promise<NewDstSyncRecord[]> {
		const network = this.config.networkConfig.get(this.networkName)!;
		const logs = await getLogsByBlock(false, this.config, this.ethersConfig, this.networkName, this.provider, fromBlockNumber, toBlockNumber);
		return constructDstERC20Records(this.networkName, this.config, this.ethersConfig, this.provider, network, logs);

	}

	async getDstNativeSyncRecords(fromBlockNumber: number, toBlockNumber: number, lastSkipBlockNumbers: number[], skipBlocks: Array<number>): Promise<NewDstSyncRecord[]> {
		const network = this.config.networkConfig.get(this.networkName)!;

		const chain = this.config.chainConfig.getChainInfoByName(this.networkName);

		const range = constructBlockRange(fromBlockNumber, toBlockNumber, lastSkipBlockNumbers);
		const batchOfTransactions = await Promise.all(
			range.map((blockNumber) => getDstTransactionsByBlock(this.config, chain, this.provider, blockNumber, skipBlocks))
		);
		return constructDstNativeRecords(this.config, network, batchOfTransactions.flat());
	}

	async getTxReceipt(txHash: string): Promise<TxReceipt | null> {
		const receipt = await this.provider.getTransactionReceipt(txHash);
		if (receipt === null) {
			return null
		}
		return {
			status: receipt.status,
			fee: {
				gasUsed: receipt.gasUsed,
				gasPrice: receipt.gasPrice,
				fee: receipt.gasUsed * receipt.gasPrice,
			},
		}
	}

	async getTxStatus(txHash: string): Promise<boolean | null> {
    try {
      const receipt = await this.getTxReceipt(txHash);
      if (receipt === null || receipt.status === null) {
        return null
      }
      return receipt.status === 1;
    } catch (e) {
      return null;
    }
	}

	async getTxFee(txHash: string): Promise<TxFee> {
		const receipt = await this.getTxReceipt(txHash);
		if (receipt === null) {
			return { gasUsed: null, gasPrice: null, fee: null };
		}

		return receipt.fee;
	}

	async getTxNonce(txHash: string): Promise<number | null> {
		const tx = await this.provider.getTransaction(txHash);
		if (tx === null) {
			return null;
		}
		return tx.nonce;
	}

	async getTxBlockNumber(txHash: string): Promise<number | null> {
		const tx = await this.provider.getTransaction(txHash);
		if (tx === null) {
			return null;
		}
		return tx.blockNumber;
	}

	async getERC20Balance(address: string, tokenAddress: string): Promise<bigint> {
		const erc20 = new ethers.Contract(tokenAddress, this.ethersConfig.erc20Abi, this.provider);
		return erc20.balanceOf(address);
	}

	async getAllowance(address: string, tokenAddress: string): Promise<bigint> {
		const erc20 = new ethers.Contract(tokenAddress, this.ethersConfig.erc20Abi, this.provider);
		return erc20.allowance(this.config.makerAddress, address);
	}

	async getNativeBalance(address: string): Promise<bigint> {
		return this.provider.getBalance(address)
	}

  async getBalance(address: string, token: utils.TokenInfo): Promise<bigint> {
    if (token.address === ethers.ZeroAddress) {
      return this.getNativeBalance(address);
    } else {
      return this.getERC20Balance(address, token.address);
    }
  }

	async getNonce(address: string): Promise<number> {
    if (address === "self") {
		  return this.provider.getTransactionCount(this.testAddress!);
    } else {
		  return this.provider.getTransactionCount(address)
    }
	}

	async estimateNativeTransferGas(to: string, value: bigint): Promise<bigint> {
		const feeData = await this.provider.getFeeData();
		const chainInfo = this.config.chainConfig.getChainInfoByName(this.networkName);
    if (this.networkName === "ScrollMainnet"
        || this.networkName === "EthereumMainnet"
        || this.networkName === "OptimismMainnet"
        || this.networkName === "BaseMainnet"
        || this.networkName === "MantaMainnet"
        || this.networkName === "LineaMainnet"
        || this.networkName === "BevmMainnet") {
      return 21000n;
    }

    let wallet: ethers.AbstractSigner;
    if (this.privateKey === undefined) {
		  wallet = this.getWalletByName(this.networkName, this.config.env);
    } else {
		  wallet = this.getWalletFor(this.privateKey, this.networkName);
    }
		let estimatedGas: bigint
		if (feeData.maxPriorityFeePerGas === null && feeData.gasPrice !== null) { // pre EIP-1599
			estimatedGas = await wallet.estimateGas({
				to: to.toLowerCase(),
				value: value,
				type: 0x0,
				chainId: chainInfo.chainId,
			});
		} else {
			estimatedGas = await wallet.estimateGas({
				to: to.toLowerCase(),
				value: value,
				type: 2,
				chainId: chainInfo.chainId,
			});
		}

		estimatedGas = estimatedGas + estimatedGas * 10n / 100n;
		utils.log("call estimatedGas:", estimatedGas.toString());
		return estimatedGas;
	}

	async estimateERC20TransferGas(tokenAddress: string, recipient: string, value: bigint): Promise<bigint> {
		const feeData = await this.provider.getFeeData();
		const chainInfo = this.config.chainConfig.getChainInfoByName(this.networkName);
    let wallet: ethers.AbstractSigner;
    if (this.privateKey === undefined) {
		  wallet = this.getWalletByName(this.networkName, this.config.env);
    } else {
		  wallet = this.getWalletFor(this.privateKey, this.networkName);
    }
		let estimatedGas: bigint
		if (feeData.maxPriorityFeePerGas === null && feeData.gasPrice !== null) { // pre EIP-1599
			estimatedGas = await wallet.estimateGas({
				to: tokenAddress,
				value: 0x0,
				type: 0x0,
				chainId: chainInfo.chainId,
				data: this.ethersConfig.erc20Interface.encodeFunctionData("transfer", [recipient, value]),
			});
		} else {
			estimatedGas = await wallet.estimateGas({
				to: tokenAddress,
				value: 0x0,
				type: 2,
				chainId: chainInfo.chainId,
				data: this.ethersConfig.erc20Interface.encodeFunctionData("transfer", [recipient, value]),
			});
		}

		estimatedGas = estimatedGas + estimatedGas * 10n / 100n;
		utils.log("call estimatedGas:", estimatedGas.toString());
		return estimatedGas;
	}

  async estimateApproveERC20Gas(tokenAddress: string, value: bigint, spender?: string): Promise<bigint> {
    const feeData = await this.provider.getFeeData();
    const chainInfo = this.config.chainConfig.getChainInfoByName(this.networkName);
    let wallet: ethers.AbstractSigner;
    if (this.privateKey === undefined) {
      wallet = this.getWalletByName(this.networkName, this.config.env);
    } else {
      wallet = this.getWalletFor(this.privateKey, this.networkName);
    }
    let estimatedGas: bigint
    if (feeData.maxPriorityFeePerGas === null && feeData.gasPrice !== null) { // pre EIP-1599
      estimatedGas = await wallet.estimateGas({
        to: tokenAddress,
        value: 0x0,
        type: 0x0,
        chainId: chainInfo.chainId,
        data: this.ethersConfig.erc20Interface.encodeFunctionData("approve", [spender ?? this.transferContractAddress, value]),
      });
    } else {
      estimatedGas = await wallet.estimateGas({
        to: tokenAddress,
        value: 0x0,
        type: 2,
        chainId: chainInfo.chainId,
        data: this.ethersConfig.erc20Interface.encodeFunctionData("approve", [spender ?? this.transferContractAddress, value]),
      });
    }

    estimatedGas = estimatedGas + estimatedGas * 10n / 100n;
    utils.log("call estimatedGas:", estimatedGas.toString());
    return estimatedGas;
  }

	async estimateTransferContractGas(tokenAddress: string, recipient: string, value: bigint): Promise<bigint> {
		const feeData = await this.provider.getFeeData();
		const chainInfo = this.chainInfo;
    let wallet: ethers.AbstractSigner;
    if (this.privateKey === undefined) {
		  wallet = this.getWalletByName(this.networkName, this.config.env);
    } else {
		  wallet = this.getWalletFor(this.privateKey, this.networkName);
    }
		let estimatedGas: bigint

    const contractAddress = this.chainInfo.transferContractAddress;
    if (contractAddress === undefined) {
      throw new Error("transfer contract address is undefined");
    }
    const makerAddress = this.config.makerAddress;

    let txValue = 0n;
    if (tokenAddress === ethers.ZeroAddress) {
      txValue = value;
    }
		if (feeData.maxPriorityFeePerGas === null && feeData.gasPrice !== null) { // pre EIP-1599
			const tx = {
				to: contractAddress,
				value: txValue,
				type: 0x0,
				chainId: chainInfo.chainId,
				data: this.ethersConfig.transferContractInterface.encodeFunctionData(
          "transfer", [recipient, tokenAddress, makerAddress, value]),
			}
      estimatedGas = await wallet.estimateGas(tx);
		} else {
			const tx = {
				to: contractAddress,
				value: txValue,
				type: 2,
				chainId: chainInfo.chainId,
				data: this.ethersConfig.transferContractInterface.encodeFunctionData(
          "transfer", [recipient, tokenAddress, makerAddress, value]),
			}
      estimatedGas = await wallet.estimateGas(tx);
		}

		estimatedGas = estimatedGas + estimatedGas * 1n / 100n
		utils.log("call estimatedGas:", estimatedGas.toString());
		return estimatedGas;
	}

	async getGasPrice(): Promise<GasPriceResult> {
		const feeData = await this.provider.getFeeData();
		if (feeData.maxPriorityFeePerGas === null && feeData.gasPrice !== null) {
			return {
				gasPrice: feeData.gasPrice,
				maxFeePerGas: null,
			}
		} else {
			return {
				gasPrice: feeData.maxPriorityFeePerGas || BigInt(0),
				maxFeePerGas: feeData.maxFeePerGas,
			}
		}
	}

	async estimateGasPrice(req: GasPriceRequest, gasLimit: bigint, isNativeTransfer: boolean): Promise<GasPriceResult> {
		//const feeData = await this.provider.getFeeData();
    let feeData: ethers.FeeData;
    if (this.networkName === "LineaMainnet") {
      feeData = new ethers.FeeData(2260255902n, 1000000014n, 1000000000n);
    } else {
      feeData = await this.provider.getFeeData();
    }
		const eip1559 = (feeData.maxPriorityFeePerGas !== null || feeData.gasPrice === null);
		if (eip1559) {
			const [maxPriorityFeePerGas, maxFeePerGas] = getGasPrice(feeData, gasLimit, req.isSpeedUp, req.oldMaxPriorityFeePerGas, req.oldMaxFeePerGas, this.networkName, isNativeTransfer)
			return {
				gasPrice: maxPriorityFeePerGas,
				maxFeePerGas: maxFeePerGas,
			}
		} else {
			const gasPrice = getPreEIP1559GasPrice(feeData, gasLimit, req.isSpeedUp, req.oldGasPrice, this.networkName, isNativeTransfer)
			return {
				gasPrice: gasPrice,
				maxFeePerGas: null,
			}
		}
	}

	async sendNativeTransfer(req: NativeTransferRequest): Promise<SendTransactionResult> {
		const tx: ethers.TransactionRequest = {
			to: req.to,
			value: req.value,
			gasLimit: utils.bigint2Hex(req.gasLimit),
			nonce: req.nonce,
			type: 2,
			chainId: this.chainId,
		}

		if (req.gasPrice.maxFeePerGas === null) {
			// non eip-1559
			tx.gasPrice = req.gasPrice.gasPrice;
      tx.type = 0x0;
		} else {
			tx.maxPriorityFeePerGas = req.gasPrice.gasPrice;
			tx.maxFeePerGas = req.gasPrice.maxFeePerGas;
      tx.type = 2;
		}

    let wallet: ethers.AbstractSigner;
    if (this.privateKey === undefined) {
		  wallet = this.getWalletByName(this.networkName, this.config.env);
    } else {
      wallet = this.getWalletFor(this.privateKey, this.networkName);
    }

		const rsp = await wallet.sendTransaction(tx);
		return {
      chainId: this.chainId,
			hash: rsp.hash,
		}
	}

	async sendERC20Transfer(req: ERC20TransferRequest): Promise<SendTransactionResult> {
		const tx: ethers.TransactionRequest = {
			to: req.tokenAddress,
			value: 0x0,
			gasLimit: utils.bigint2Hex(req.gasLimit),
			nonce: req.nonce,
			type: 2,
			chainId: this.chainId,
			data: this.ethersConfig.erc20Interface.encodeFunctionData("transfer", [req.recipient, req.value]),
		}

		if (req.gasPrice.maxFeePerGas === null) {
			// non eip-1559
			tx.gasPrice = req.gasPrice.gasPrice;
      tx.type = 0x0;
		} else {
			tx.maxPriorityFeePerGas = req.gasPrice.gasPrice;
			tx.maxFeePerGas = req.gasPrice.maxFeePerGas;
      tx.type = 2;
		}

    let wallet: ethers.AbstractSigner;
    if (this.privateKey === undefined) {
		  wallet = this.getWalletByName(this.networkName, this.config.env);
    } else {
      wallet = this.getWalletFor(this.privateKey, this.networkName);
    }

		const rsp = await wallet.sendTransaction(tx);
		return {
      chainId: this.chainId,
			hash: rsp.hash,
		}
	}

  async approveERC20(req: ApproveERC20Request): Promise<SendTransactionResult> {
    const tx: ethers.TransactionRequest = {
      to: req.tokenAddress,
      value: 0x0,
      gasLimit: utils.bigint2Hex(req.gasLimit),
      nonce: req.nonce,
      type: 2,
      chainId: this.chainId,
      data: this.ethersConfig.erc20Interface.encodeFunctionData("approve", [req.spender ?? this.transferContractAddress, req.value]),
    }

    if (req.gasPrice.maxFeePerGas === null) {
      // non eip-1559
      tx.gasPrice = req.gasPrice.gasPrice;
      tx.type = 0x0;
    } else {
      tx.maxPriorityFeePerGas = req.gasPrice.gasPrice;
      tx.maxFeePerGas = req.gasPrice.maxFeePerGas;
      tx.type = 2;
    }

    let wallet: ethers.AbstractSigner;
    if (this.privateKey === undefined) {
      wallet = this.getWalletByName(this.networkName, this.config.env);
    } else {
      wallet = this.getWalletFor(this.privateKey, this.networkName);
    }

    const rsp = await wallet.sendTransaction(tx);
    return {
      chainId: this.chainId,
      hash: rsp.hash,
    }
  }

  async sendTransferContract(req: ERC20TransferRequest): Promise<SendTransactionResult> {
    const contractAddress = this.chainInfo.transferContractAddress;
    if (contractAddress === undefined) {
      throw new Error("transfer contract address is undefined");
    }

    let txValue = 0n;
    if (req.tokenAddress === ethers.ZeroAddress) {
      txValue = req.value;
    }
    const tx: ethers.TransactionRequest = {
      to: contractAddress,
      value: txValue,
      gasLimit: utils.bigint2Hex(req.gasLimit),
      nonce: req.nonce,
      type: 2,
      chainId: this.chainId,
		  data: this.ethersConfig.transferContractInterface.encodeFunctionData(
          "transfer", [req.recipient, req.tokenAddress, this.config.makerAddress, req.value]),
    }

    if (req.gasPrice.maxFeePerGas === null) {
      // non eip-1559
      tx.gasPrice = req.gasPrice.gasPrice;
      tx.type = 0x0;
    } else {
      tx.maxPriorityFeePerGas = req.gasPrice.gasPrice;
      tx.maxFeePerGas = req.gasPrice.maxFeePerGas;
      tx.type = 2;
    }
    let wallet: ethers.AbstractSigner;
    if (this.privateKey === undefined) {
		  wallet = this.getWalletByName(this.networkName, this.config.env);
    } else {
      wallet = this.getWalletFor(this.privateKey, this.networkName);
    }

		const rsp = await wallet.sendTransaction(tx);
		return {
      chainId: this.chainId,
			hash: rsp.hash,
		}
  }
}

async function getLogsByBlock(
  isSrc: boolean,
	config: Config,
	ethersConfig: EthersConfig,
	networkName: string,
	provider: ethers.Provider,
	fromBlockNumber: number,
	toBlockNumber: number,
  transferContractAddress?: string) {

  let logs: Array<ethers.Log> = [];
  if (isSrc && transferContractAddress !== undefined) {
    const transferLogs = await provider.getLogs({
      fromBlock: fromBlockNumber,
      toBlock: toBlockNumber,
      address: transferContractAddress,
      topics: [ethersConfig.transferContractSignature],
    });
    logs.push(...transferLogs);
  }

	const logsERC20 = await provider.getLogs({
		fromBlock: fromBlockNumber,
		toBlock: toBlockNumber,
		address: config.tokenConfig.getErc20AddressesByNetworkName(networkName),
		topics: [ethersConfig.erc20TransferSignature],
	});

  logs.push(...logsERC20);

  return logs;
}

async function constructERC20Records(
	networkName: string,
	config: Config,
	ethersConfig: EthersConfig,
	provider: ethers.Provider,
	chain: utils.Network,
	logs: Array<ethers.Log>,
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
			const txInfo = await provider.getTransaction(txHash);
			if (txInfo !== null) {
				src_nonce = txInfo.nonce;
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
      if (src_cctp !== null && min_value !== null) {
        const cctpDtc = await utils.getCCTP_DTC(config.db, chainId, dstChainId);
        if(value - ethers.parseUnits(cctpDtc, tokenDecimal) >= ethers.parseUnits(min_value.min_value, tokenDecimal)) {
          is_cctp = 1;
          utils.alertCCTP(config.env, "new CCTP tx " + txHash + ", chainId=" + chainId + ", value=" + value);
        }
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


function constructSrcNativeRecords(
	config: Config,
	chain: utils.ChainInfo,
	txs: Array<ethers.TransactionResponse>): Array<NewSrcSyncRecord> {

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

		const chainId = Number(item.chainId);
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
			src_nonce: item.nonce,
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

async function constructDstERC20Records(
	networkName: string,
	config: Config,
	ethersConfig: EthersConfig,
	provider: ethers.Provider,
	network: utils.Network,
	logs: Array<ethers.Log>): Promise<Array<NewDstSyncRecord>> {

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
			const txInfo = await provider.getTransaction(txHash);
			if (txInfo === null) {
				utils.log("getTransaction failed, txHash=" + txHash);
				continue;
			} else {
				dst_nonce = txInfo.nonce;
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

async function getGappedBlockNumber(
	config: Config,
	chain: utils.ChainInfo): Promise<number[]> {

	const result: Array<number> = [];

	const items = await config.db.t_gapped_block.findMany({
		select: {
			block_number: true,
		},
		where: {
			chainid: chain.chainId,
			appid: config.appid,
			is_processed: 0,
		},
		take: 3,
	});

	for (const item of items) {
		result.push(item.block_number);
	}

	return result;
}

async function getSrcTransactionsByBlock(
	config: Config,
	provider: ethers.Provider,
	chain: utils.ChainInfo,
	blockNumber: number, 
  skipBlocks: Array<number>): Promise<Array<ethers.TransactionResponse>> {

	const result: Array<ethers.TransactionResponse> = [];
  try {
    const block = await provider.getBlock(BigInt(blockNumber), true);
    if (block === null) {
      throw new Error("block is null, block number =" + blockNumber + "chainid =" + chain.chainId);
    }

    if (block.prefetchedTransactions === null) {
      utils.log("prefetchedTransaction is null, block number =", blockNumber, "chainid =", chain.chainId);
      return result;
    }

    for (const tx of block.prefetchedTransactions) {
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
      result.push(tx);
    }

    if (result.length === 0 && chain.chainId === 1) {
      utils.log("no valid src tx found, block number =", blockNumber);
    }
  } catch (error) {
    skipBlocks.push(blockNumber);
    utils.log(error);
  }
	return result;
}

async function getDstTransactionsByBlock(
	config: Config,
	chain: utils.ChainInfo,
	provider: ethers.Provider,
	blockNumber: number,
  skipBlocks: Array<number>): Promise<Array<ethers.TransactionResponse>> {

	const result: Array<ethers.TransactionResponse> = [];
  try {
    const block = await provider.getBlock(BigInt(blockNumber), true);

    if (block === null) {
      throw new Error("block is null, block number =" + blockNumber + "chainid =" + chain.chainId);
    }

    if (block.prefetchedTransactions === null) {
      return result;
    }

    for (const tx of block.prefetchedTransactions) {
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
        result.push(tx);
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
	txs: Array<ethers.TransactionResponse>): Array<NewDstSyncRecord> {

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
			dst_nonce: item.nonce,
			dst_tx_hash: item.hash,
			is_verified: 1,
		});
	}

	return records;
}

function getPreEIP1559GasPrice(
	feeData: ethers.FeeData,
	estimatedGas: bigint,
	isSpeedUp: boolean,
	oldGasPrice: bigint | null, // from mysql table
	networkName: string,
	isNativeTransfer: boolean): bigint {

	const initEthGasMap = new Map<string, bigint>();
	const initErc20GasMap = new Map<string, bigint>();

	initEthGasMap.set("PolygonZkMainnet", ethers.parseEther("0.00002"));
	initErc20GasMap.set("PolygonZkMainnet", ethers.parseEther("0.00002"));

	// feeData.gasPrice can't be null
	let gasPrice = feeData.gasPrice! + feeData.gasPrice! * 15n / 100n;

	let gasMap: Map<string, bigint>;
	if (isNativeTransfer) {
		gasMap = initEthGasMap;
	} else {
		gasMap = initErc20GasMap;
	}
	const initGas = gasMap.get(networkName);
	if (initGas !== undefined) {
		const initGasPrice = initGas / estimatedGas;
		if (gasPrice < initGasPrice) {
			gasPrice = initGasPrice;
		}
	}

	if (isSpeedUp && oldGasPrice !== null) {
		if (oldGasPrice >= gasPrice) {
			gasPrice = oldGasPrice + oldGasPrice * 15n / 100n; // speed up 15%
		}
	}

	return gasPrice;
}

function getGasPrice(
	feeData: ethers.FeeData,
	estimatedGas: bigint,
	isSpeedUp: boolean,
	oldMaxPriorityFeePerGas: bigint | null,
	oldMaxFeePerGas: bigint | null,
	networkName: string,
	isNativeTransfer: boolean): [bigint, bigint] {

	const initEthGasMap = new Map<string, bigint>();
	const initErc20GasMap = new Map<string, bigint>();

	initEthGasMap.set("LineaMainnet", ethers.parseEther("0.00013"));
	initEthGasMap.set("BaseMainnet", ethers.parseEther("0.00008"));
	//initEthGasMap.set("LineaGoerli", ethers.parseEther("0.01"));
	initEthGasMap.set("TaikoSepolia", ethers.parseEther("0.0004"));

	initErc20GasMap.set("LineaMainnet", ethers.parseEther("0.0004"));

	let maxPriorityFeePerGas = feeData.maxPriorityFeePerGas as bigint;
	let maxFeePerGas = feeData.maxFeePerGas as bigint;

	let gasMap: Map<string, bigint>;
	if (isNativeTransfer) {
		gasMap = initEthGasMap;
	} else {
		gasMap = initErc20GasMap;
	}

	const initGas = gasMap.get(networkName);
	if (initGas !== undefined) {
		const initGasPrice = initGas / estimatedGas;
		if (maxPriorityFeePerGas < initGasPrice) {
			maxPriorityFeePerGas = initGasPrice;
		}
		maxFeePerGas = maxFeePerGas + maxFeePerGas * 50n / 100n;
	} else {
		maxPriorityFeePerGas = maxPriorityFeePerGas + maxPriorityFeePerGas * 5n / 100n;
		maxFeePerGas = maxFeePerGas + ethers.parseUnits("20", "gwei");
	}

	if (maxFeePerGas <= maxPriorityFeePerGas) {
		maxFeePerGas = maxPriorityFeePerGas + maxPriorityFeePerGas * 20n / 100n;
	}

	if (isSpeedUp) { // only speed up Linea Testnet and Scroll Testnet, for safety
		if (oldMaxPriorityFeePerGas != null) {
			if (oldMaxPriorityFeePerGas >= maxPriorityFeePerGas) {
				maxPriorityFeePerGas = oldMaxPriorityFeePerGas + oldMaxPriorityFeePerGas * 20n / 100n;
			}
		}

		if (oldMaxFeePerGas != null) {
			if (oldMaxFeePerGas >= maxFeePerGas) {
				maxFeePerGas = oldMaxFeePerGas + oldMaxFeePerGas * 20n / 100n;
			}
		}
	}

	return [maxPriorityFeePerGas, maxFeePerGas];
}
