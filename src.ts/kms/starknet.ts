import * as starknet from "starknet";
import * as axios from "axios";

export class StarknetKmsSigner implements starknet.SignerInterface {
	protected name: string;
	protected client: axios.AxiosInstance;

	constructor(client: axios.AxiosInstance, name: string) {
		this.client = client;
		this.name = name;
	}

	static create(baseUrl: string, apiKey: string, name: string): StarknetKmsSigner {
		const client = axios.default.create({
			baseURL: baseUrl,
			auth: {
				username: apiKey,
				password: "",
			},
		})
		return new StarknetKmsSigner(client, name);
	}

	public async getPubKey(): Promise<string> {
		const rsp = await this.client.post<string>("/pubkey/starknet", {
			name: this.name,
		});
		return rsp.data;
	}

	public async signMessage(typedData: starknet.TypedData, accountAddress: string): Promise<starknet.Signature> {
		const msgHash = starknet.typedData.getMessageHash(typedData, accountAddress);
		return this._signDigest(msgHash);
	}

	public async signTransaction(
		transactions: starknet.Call[],
		transactionsDetail: starknet.InvocationsSignerDetails,
		abis?: starknet.Abi[]
	): Promise<starknet.Signature> {
		if (abis && abis.length !== transactions.length) {
			throw new Error('ABI must be provided for each transaction or no transaction');
		}
		// now use abi to display decoded data somewhere, but as this signer is headless, we can't do that

		const calldata = starknet.transaction.getExecuteCalldata(transactions, transactionsDetail.cairoVersion);

		const msgHash = starknet.hash.calculateTransactionHash(
			transactionsDetail.walletAddress,
			transactionsDetail.version,
			calldata,
			transactionsDetail.maxFee,
			transactionsDetail.chainId,
			transactionsDetail.nonce
		);

		return this._signDigest(msgHash);
	}

	public async signDeployAccountTransaction({
		classHash,
		contractAddress,
		constructorCalldata,
		addressSalt,
		maxFee,
		version,
		chainId,
		nonce,
	}: starknet.DeployAccountSignerDetails): Promise<starknet.Signature> {
		const msgHash = starknet.hash.calculateDeployAccountTransactionHash(
			contractAddress,
			classHash,
			starknet.CallData.compile(constructorCalldata),
			addressSalt,
			version,
			maxFee,
			chainId,
			nonce
		);

		return this._signDigest(msgHash);
	}

	public async signDeclareTransaction(
		// contractClass: ContractClass,  // Should be used once class hash is present in ContractClass
		{
			classHash,
			senderAddress,
			chainId,
			maxFee,
			version,
			nonce,
			compiledClassHash,
		}: starknet.DeclareSignerDetails
	): Promise<starknet.Signature> {
		const msgHash = starknet.hash.calculateDeclareTransactionHash(
			classHash,
			senderAddress,
			version,
			maxFee,
			chainId,
			nonce,
			compiledClassHash
		);

		return this._signDigest(msgHash);
	}

	async _signDigest(hash: string): Promise<string[]> {
		if (hash.length % 2 == 1) {
			if (hash.startsWith("0x")) {
				hash = hash.slice(2);
			}
			hash = "0x0" + hash;
		}
		const rsp = await this.client.post<StarknetSignResponse>("/sign/starknet", {
			digest: hash,
			name: this.name,
		})
		return rsp.data.signature;
	}
}

interface StarknetSignResponse {
	signature: string[]
}
