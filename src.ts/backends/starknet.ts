import * as utils from "../utils/index.js";
import { ethers } from "ethers";
import {
	uint256, constants, selector, getChecksumAddress,
	RpcProvider, Account, Contract, Abi, RPC,
} from "starknet";
import {isValidCrossChainSrcTxV2, isValidDstTx} from "../bin/validate.js";
import {NewSrcSyncRecord, NewDstSyncRecord} from "../bin/type.js";
import {
	Backend, NativeTransferRequest,
	ERC20TransferRequest, SendTransactionResult,ApproveERC20Request,
	GasPriceResult, GasPriceRequest, TxReceipt, TxFee,
} from "./types.js";
import {Config} from "./config.js";

const EventChunkSize = 1000;

interface StarknetConfig {
	rpc: string;
	erc20Abi: Abi;
	erc20TransferSelector: string;

  transferContractAbi: Abi;
  transferContractSelector: string;
}

function getStarknetChainId(chainId: number) {
  if (chainId === 555555555) {
    return constants.StarknetChainId.SN_GOERLI;
  } else if (chainId === 666666666) {
    return constants.StarknetChainId.SN_MAIN;
  }
  throw new Error(`unsupported chain id ${chainId}`);
}

export class StarknetBackend implements Backend {
	networkName: string;
	chainId: number;
  chainInfo: utils.ChainInfo;
	config: Config;
	starknetConfig: StarknetConfig;
	account: Account;
  testAccount?: Account;
	provider: RpcProvider;
	makerAddress: string;
  testAddress?: string;
  transferContractAddress?: string;

	constructor(config: Config, networkName: string, starknetConfig: StarknetConfig, testPrivateKey?: string, testAddress?: string) {
    const chainInfo = config.chainConfig.getChainInfoByName(networkName);

		this.networkName = networkName
		this.config = config;
		this.chainId = chainInfo.chainId;
    this.chainInfo = chainInfo;
    this.transferContractAddress = chainInfo.transferContractAddress;
		this.starknetConfig = starknetConfig;

    const realChainId = getStarknetChainId(chainInfo.chainId);
		this.provider = new RpcProvider({
			nodeUrl: starknetConfig.rpc,
			chainId: realChainId,
		});

		const pkOrSigner = config.starknetMakerConfig.getStarknetSigner(config.env);
    const makerAddress = config.starknetMakerConfig.getMakerAddress(config.env);
		this.account = new Account(this.provider, makerAddress, pkOrSigner);
		this.makerAddress = makerAddress;

    this.testAddress = testAddress;
    if (testPrivateKey !== undefined && testAddress !== undefined) {
      this.testAccount = new Account(this.provider, testAddress, testPrivateKey);
    }
	}

	async setup(): Promise<void> {
		await this.provider.getChainId();
	}

	async getBlockNumber(): Promise<number> {
		return this.provider.getBlockNumber();
	}

	async getBaseFee(blockTag: string | number): Promise<bigint | null> {
		// don't support eip-1559
		return null;
	}

	async getSrcERC20SyncRecords(fromBlockNumber: number, toBlockNumber: number, gappedBlockNumber: number | null): Promise<NewSrcSyncRecord[]> {
    const records: NewSrcSyncRecord[] = [];
    
    if (this.transferContractAddress === undefined) {
      return records;
    }

		const network = this.config.networkConfig.get(this.networkName)!;
		const filterKey = this.starknetConfig.transferContractSelector

		let rsp: RPC.GetEventsResponse = {events: []}
		do {
			rsp = await this.provider.getEvents({
				from_block: {block_number: fromBlockNumber},
				to_block: {block_number: toBlockNumber},
				address: this.transferContractAddress,
				keys: [[filterKey]],
				chunk_size: EventChunkSize,
				continuation_token: rsp.continuation_token,
		  });
			records.push(...await constructERC20SrcRecords(
				this.networkName, this.config, this, network,
				this.makerAddress, rsp.events
			));
		} while (rsp.continuation_token);

		if (gappedBlockNumber !== null &&
        (gappedBlockNumber < fromBlockNumber || gappedBlockNumber > toBlockNumber)) {
			let rsp: RPC.GetEventsResponse = {events: []}
			do {
				rsp = await this.provider.getEvents({
					from_block: {block_number: gappedBlockNumber},
					to_block: {block_number: gappedBlockNumber},
					address: this.transferContractAddress,
					keys: [[filterKey]],
					chunk_size: EventChunkSize,
					continuation_token: rsp.continuation_token,
				});

				records.push(...await constructERC20SrcRecords(
					this.networkName, this.config, this, network,
					this.makerAddress, rsp.events
				));
			} while (rsp.continuation_token)
		}
		return records
	}

	async getSrcNativeSyncRecords(fromBlockNumber: number, toBlockNumber: number, gappedBlockNumbers: number[], skipBlocks: Array<number | null>): Promise<NewSrcSyncRecord[]> {
		throw new Error("don't support native transactions on starknet")
	}

	async getDstERC20SyncRecords(fromBlockNumber: number, toBlockNumber: number): Promise<NewDstSyncRecord[]> {
		const records: NewDstSyncRecord[] = [];
		const addresses = this.config.tokenConfig.getErc20AddressesByNetworkName(this.networkName);
		const network = this.config.networkConfig.get(this.networkName)!;
		const filterKey = this.starknetConfig.erc20TransferSelector
		for (const address of addresses) {
			let rsp: RPC.GetEventsResponse = {events: []}
			do {
				rsp = await this.provider.getEvents({
					from_block: {block_number: fromBlockNumber},
					to_block: {block_number: toBlockNumber},
					address: address,
					keys: [[filterKey]],
					chunk_size: EventChunkSize,
					continuation_token: rsp.continuation_token,
				})
				records.push(...await constructDstERC20Records(
					this.networkName, this.config, this, network,
					this.makerAddress, rsp.events
				));
			} while (rsp.continuation_token)
		}
		return records
	}

	async getDstNativeSyncRecords(fromBlockNumber: number, toBlockNumber: number, skipBlockNumbers: number[], skipBlocks: Array<number>): Promise<NewDstSyncRecord[]> {
		throw new Error("don't support native transactions on starknet")
	}

	async getTxStatus(txHash: string): Promise<boolean | null> {
    let receipt: RPC.TransactionReceipt | null = null;
    try {
      receipt = await this.provider.getTransactionReceipt(txHash);
    } catch (e) {
      utils.log(`starknet getTxStatus failed: ${e}`);
    }
		if (receipt === null) {
			return null
		}
    if ("status" in receipt) {
      if (receipt["status"] === "ACCEPTED_ON_L2") {
        return true;
      }
    }

		if ('execution_status' in receipt) {
			if (receipt.execution_status === "SUCCEEDED") {
				return true
			}
			return false
		}
		return null
	}

	async getTxFee(txHash: string): Promise<TxFee> {
		const receipt = await this.provider.getTransactionReceipt(txHash);
		return {
			gasUsed: null,
			gasPrice: null,
			fee: BigInt(receipt.actual_fee),
		}
	}

	async getTxReceipt(txHash: string): Promise<TxReceipt | null> {
		const receipt = await this.provider.getTransactionReceipt(txHash)
		if (receipt === null) {
			return null
		}
		let status = 0;
		if ('execution_status' in receipt) {
			if (receipt.execution_status === "SUCCEEDED") {
				status = 1
			}
		}
		return {
			status: status,
			fee: {
				gasPrice: null,
				gasUsed: null,
				fee: BigInt(receipt.actual_fee),
			},
		}
	}

	async getTxNonce(txHash: string): Promise<number | null> {
		const tx = await this.provider.getTransaction(txHash)
		if (tx === null) {
			return null
		}
		if (!tx.nonce) {
			return null
		}
		return Number(tx.nonce)
	}

	async getTxBlockNumber(txHash: string): Promise<number | null> {
		const receipt = await this.provider.getTransactionReceipt(txHash)
		if (receipt === null) {
			return null
		}
		if ('block_number' in receipt) {
      return Number(receipt.block_number);
    }
		return null
	}

  getAccount(): Account {
    let account: Account;
    if (this.testAccount === undefined) {
      account = this.account;
    } else {
      account = this.testAccount;
    }
    return account;
  }

	async getGasPrice(): Promise<GasPriceResult> {
    const account = this.getAccount();
		const fee = await account.estimateFee([]);
		return {
			gasPrice: fee.gas_price!,
			maxFeePerGas: null,
		}
	}

	async estimateGasPrice(req: GasPriceRequest, gasLimit: bigint, isNativeTransfer: boolean): Promise<GasPriceResult> {
		const feeData = await this.getGasPrice();
		let gasPrice = feeData.gasPrice + feeData.gasPrice * 15n / 100n;

		if (req.isSpeedUp && req.oldGasPrice !== null) {
			if (req.oldGasPrice >= gasPrice) {
				gasPrice = req.oldGasPrice + req.oldGasPrice * 15n / 100n; // speed up 15%
			}
		}

		return {
			gasPrice: gasPrice,
			maxFeePerGas: null,
		}
	}

	async getNonce(address: string): Promise<number> {
    if (address === "self") {
      address = this.testAddress as string;
    }
		const nonce = await this.provider.getNonceForAddress(address, "pending");
		return Number(nonce);
	}

	async getERC20Balance(address: string, tokenAddress: string): Promise<bigint> {
		const erc20 = new Contract(this.starknetConfig.erc20Abi, tokenAddress, this.provider);
		const balanceInitial = await erc20.balanceOf(address);
		return uint256.uint256ToBN(balanceInitial.balance);
	}

  async getAllowance(address: string, tokenAddress: string): Promise<bigint> {
    const erc20 = new Contract(this.starknetConfig.erc20Abi, tokenAddress, this.provider);
    const balanceInitial = await erc20.allowance(this.makerAddress, address);
    return uint256.uint256ToBN(balanceInitial.balance);
  }

	async getNativeBalance(address: string): Promise<bigint> {
		throw new Error("starknet don't support native token")
	}

  async getBalance(address: string, token: utils.TokenInfo): Promise<bigint> {
    if (token.address === ethers.ZeroAddress) {
      return this.getNativeBalance(address);
    }
    return this.getERC20Balance(address, token.address);
  }

	async estimateNativeTransferGas(to: string, value: bigint): Promise<bigint> {
		throw new Error("starknet don't support native transfers")
	}

	async estimateERC20TransferGas(tokenAddress: string, recipient: string, value: bigint): Promise<bigint> {
    const account = this.getAccount();
		const erc20 = new Contract(this.starknetConfig.erc20Abi, tokenAddress, this.provider);
		erc20.connect(account);
		const rsp = await erc20.estimate("transfer", [recipient, uint256.bnToUint256(value)])
		return rsp.gas_consumed!;
	}

  async estimateApproveERC20Gas(tokenAddress: string, value: bigint, spender?: string): Promise<bigint> {
    const account = this.getAccount();
    const erc20 = new Contract(this.starknetConfig.erc20Abi, tokenAddress, this.provider);
    erc20.connect(account);
    if (this.transferContractAddress === undefined || this.transferContractAddress === ethers.ZeroAddress) {
      throw new Error("transfer contract address is undefined");
    }
    const rsp = await erc20.estimate("approve", [spender ?? this.transferContractAddress!, uint256.bnToUint256(value)]);
    return rsp.gas_consumed!;
  }

	async estimateTransferContractGas(tokenAddress: string, recipient: string, value: bigint): Promise<bigint> {
    const account = this.getAccount();
    if (this.transferContractAddress === undefined) {
      throw new Error("transfer contract address is undefined");
    }

    const transferContract = new Contract(this.starknetConfig.transferContractAbi, this.transferContractAddress, this.provider);
    transferContract.connect(account);
    const amount = uint256.bnToUint256(value);
    const rsp = await transferContract.estimate("transfer", [recipient, tokenAddress, this.makerAddress, amount]);
    return rsp.gas_consumed!;
  }

	async sendNativeTransfer(req: NativeTransferRequest): Promise<SendTransactionResult> {
		throw new Error("starknet don't support native transfers")
	}

	async sendERC20Transfer(req: ERC20TransferRequest): Promise<SendTransactionResult> {
    const account = this.getAccount();
		const erc20 = new Contract(this.starknetConfig.erc20Abi, req.tokenAddress, this.provider);
		erc20.connect(account);
		const {transaction_hash: txHash} = await erc20.transfer(req.recipient, uint256.bnToUint256(req.value), {
			maxFee: req.gasPrice.gasPrice * req.gasLimit,
      nonce: req.nonce,
		})

		return {chainId: this.chainId, hash: txHash}
	}

  async approveERC20(req: ApproveERC20Request): Promise<SendTransactionResult> {
    const account = this.getAccount();
    const erc20 = new Contract(this.starknetConfig.erc20Abi, req.tokenAddress, this.provider);
    erc20.connect(account);
    const {transaction_hash: txHash} = await erc20.approve(req.spender ?? this.transferContractAddress, uint256.bnToUint256(req.value), {
      maxFee: req.gasPrice.gasPrice * req.gasLimit,
      nonce: req.nonce,
    });

    return {chainId: this.chainId, hash: txHash};
  }

	async sendTransferContract(req: ERC20TransferRequest): Promise<SendTransactionResult> {
    const account = this.getAccount();
    if (this.transferContractAddress === undefined) {
      throw new Error("transfer contract address is undefined");
    }
		const erc20 = new Contract(this.starknetConfig.transferContractAbi, this.transferContractAddress, this.provider);
		erc20.connect(account);

		const {transaction_hash: txHash} = await erc20.transfer(req.recipient, req.tokenAddress, this.makerAddress, uint256.bnToUint256(req.value), {
			maxFee: req.gasPrice.gasPrice * req.gasLimit,
      nonce: req.nonce,
    });

    return { chainId: this.chainId, hash: txHash };
	}
}

export async function getStarknetConfig(configDir: string, rpcUrl: string): Promise<StarknetConfig> {
	const erc20Abi = await utils.getErc20Abi(configDir + "/starknet-abi/ERC20.json");
	const abiObj = JSON.parse(erc20Abi);

  const transferContractAbi = await utils.getErc20Abi(configDir + "/starknet-abi/TransferContract.json");
  const transferContractAbiObj = JSON.parse(transferContractAbi);
	return {
		rpc: rpcUrl,
		erc20Abi: abiObj,
		erc20TransferSelector: selector.getSelectorFromName("Transfer"),

    transferContractAbi: transferContractAbiObj,
    transferContractSelector: selector.getSelectorFromName("Deposit"),
	}
}

interface ContractEvent {
	from_address: string;
	keys: Array<string>;
	data: Array<string>;
	block_hash: string;
	block_number: number;
	transaction_hash: string;
}

async function constructERC20SrcRecords(
	networkName: string,
	config: Config,
	backend: Backend,
	chain: utils.Network,
	makerAddress: string,
	logs: Array<ContractEvent>,
): Promise<Array<NewSrcSyncRecord>> {
	const records: Array<NewSrcSyncRecord> = [];

	for (const log of logs) {
		const chainId = chain.chainId;
		const txHash = log.transaction_hash.toLowerCase();
		const sender = utils.normalizeAddress(log.data[0]);
    const token = utils.normalizeAddress(log.data[1]);
		const receiver = utils.normalizeAddress(log.data[2]);
    const target = utils.normalizeAddress(log.data[3], "ethers");
		const value = BigInt(log.data[4]);

		if (!isValidCrossChainSrcTxV2(
			networkName,
			config.chainConfig,
			config.makerConfig,
      config.starknetMakerConfig,
			sender,
			receiver,
			makerAddress)) {
			continue;
		}

		let src_nonce = -1;
		try {
			const nonce = await backend.getTxNonce(txHash);
			if (nonce !== null) {
				src_nonce = nonce!;
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
      }
    }
		records.push({
			chainid: chainId,
			tx_hash: txHash,
			src_nonce: src_nonce,
			dst_chainid: dstChainId,
			sender: sender,
			receiver: receiver,
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
	backend: Backend,
	network: utils.Network,
	makerAddress: string,
	logs: Array<ContractEvent>): Promise<Array<NewDstSyncRecord>> {

	const records: Array<NewDstSyncRecord> = [];
	for (const log of logs) {
		const chainId = network.chainId;
		const sender = utils.normalizeAddress(log.data[0]);
		const receiver = utils.normalizeAddress(log.data[1]);
		const value = BigInt(log.data[2]);
		const txHash = log.transaction_hash.toLowerCase();

    // sequencer event
    if (receiver.toLowerCase() === "0x01176a1BD84444c89232ec27754698E5D2E7e1A7f1539F12027f28B23ec9F3d8".toLowerCase()) {
      continue;
    }

		if (!isValidDstTx(
			networkName,
			config.chainConfig,
			config.makerConfig,
			sender,
			receiver,
			makerAddress,
			value)) {
			continue;
		}

		let dst_nonce: number;
		try {
			const nonce = await backend.getTxNonce(txHash);
			if (nonce === null) {
				utils.log("getTransaction failed, txHash=" + txHash);
				continue;
			} else {
				dst_nonce = nonce;
			}
		} catch (error) {
			utils.log("getTransaction failed, txHash=" + txHash);
			continue;
		}


		records.push({
			sender: sender,
			receiver: receiver,
			value: value.toString(),
			dst_chainid: chainId,
			dst_nonce: dst_nonce,
			dst_tx_hash: txHash,
			is_verified: 1,
		});
	}

	return records;
}
