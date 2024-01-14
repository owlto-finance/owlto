import { NewSrcSyncRecord, NewDstSyncRecord } from "../bin/type.js";
import * as utils from "../utils/index.js";
import { ethers } from "ethers";

export interface Backend {
	setup(): Promise<void>;

	getBlockNumber(): Promise<number>;
	getBaseFee(block: string | number): Promise<bigint | null>;

	getSrcERC20SyncRecords(fromBlockNumber: number, toBlockNumber: number, gappedBlockNumber: number | null): Promise<NewSrcSyncRecord[]>;
	getSrcNativeSyncRecords(fromBlockNumber: number, toBlockNumber: number, gappedBlockNumbers: number[], skipBlocks: Array<number>): Promise<NewSrcSyncRecord[]>;

	getDstERC20SyncRecords(fromBlockNumber: number, toBlockNumber: number): Promise<NewDstSyncRecord[]>;
	getDstNativeSyncRecords(fromBlockNumber: number, toBlockNumber: number, skipBlockNumbers: number[], skipBlocks: Array<number>): Promise<NewDstSyncRecord[]>;

	// get transaction status, `true`: successful, `false`: failure, `null`: not found. 
	getTxStatus(txHash: string): Promise<boolean | null>;
	getTxFee(txHash: string): Promise<TxFee>;
	getTxReceipt(txHash: string): Promise<TxReceipt | null>;
	getTxNonce(txHash: string): Promise<number | null>;
	getTxBlockNumber(txHash: string): Promise<number | null>;

	getERC20Balance(address: string, tokenAddress: string): Promise<bigint>;
	getNativeBalance(address: string): Promise<bigint>;
	getBalance(address: string, token: utils.TokenInfo): Promise<bigint>;
  getAllowance(address: string, tokenAddress: string): Promise<bigint>;

	getNonce(address: string): Promise<number>;

	estimateNativeTransferGas(to: string, value: bigint): Promise<bigint>;
	estimateERC20TransferGas(tokenAddress: string, recipient: string, value: bigint): Promise<bigint>;
	estimateTransferContractGas(tokenAddress: string, recipient: string, value: bigint): Promise<bigint>;
  estimateApproveERC20Gas(tokenAddress: string, value: bigint, spender?: string): Promise<bigint>;

	getGasPrice(): Promise<GasPriceResult>;
	estimateGasPrice(req: GasPriceRequest, gasLimit: bigint, isNativeTransfer: boolean): Promise<GasPriceResult>;

	// send native token transfer tx
	sendNativeTransfer(req: NativeTransferRequest): Promise<SendTransactionResult>;
	// send erc20 transfer tx
	sendERC20Transfer(req: ERC20TransferRequest): Promise<SendTransactionResult>;
  // send through TransferContract
	sendTransferContract(req: ERC20TransferRequest): Promise<SendTransactionResult>;
  // send approve erc20 tx
  approveERC20(req: ApproveERC20Request): Promise<SendTransactionResult>;
}

export interface ApproveERC20Request {
  tokenAddress: string;
  value: bigint;
  gasLimit: bigint;
  nonce: number;
  gasPrice: GasPriceResult;
  spender?: string;
}

export interface NativeTransferRequest {
	to: string;
	value: bigint;
	gasLimit: bigint;
	nonce: number;
	gasPrice: GasPriceResult;
}

export interface ERC20TransferRequest {
	tokenAddress: string;
	recipient: string;
	value: bigint;
	gasLimit: bigint;
	nonce: number;
	gasPrice: GasPriceResult;
}

export interface SendTransactionResult {
  chainId: number;
	hash: string;
}

export interface GasPriceRequest {
	isSpeedUp: boolean;
	oldGasPrice: bigint | null;
	oldMaxPriorityFeePerGas: bigint | null;
	oldMaxFeePerGas: bigint | null;
}

export interface GasPriceResult {
	// in eip1559, gasPrice is maxPriorityFeePerGas
	gasPrice: bigint;
	// if not eip1559 it's `null`
	maxFeePerGas: bigint | null;
}

export interface TxReceipt {
	status: number | null;
	fee: TxFee,
}

export interface TxFee {
	gasUsed: bigint | null,
	gasPrice: bigint | null,
	fee: bigint | null,
}
