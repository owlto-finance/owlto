import * as ethers from 'ethers';
import * as axios from "axios";

export class EthersKmsSigner extends ethers.AbstractSigner {
	protected address: string;
	protected client: axios.AxiosInstance;

	constructor(httpClient: axios.AxiosInstance, address: string, provider?: null | ethers.Provider) {
		super(provider);
		this.address = address;
		this.client = httpClient
	}

	static create(baseUrl: string, apiKey: string, address: string, provider?: null | ethers.Provider): EthersKmsSigner {
		const client = axios.default.create({
			baseURL: baseUrl,
			auth: {
				username: apiKey,
				password: "",
			},
		})
		return new EthersKmsSigner(client, address, provider);
	}

	async getAddress(): Promise<string> {
		return this.address;
	}

	connect(provider: null | ethers.Provider): ethers.Signer {
		return new EthersKmsSigner(this.client, this.address, provider);
	}

	async signTransaction(tx: ethers.TransactionRequest): Promise<string> {
		// Replace any Addressable or ENS name with an address
		const {to, from} = await ethers.resolveProperties({
			to: (tx.to ? ethers.resolveAddress(tx.to, this.provider) : undefined),
			from: (tx.from ? ethers.resolveAddress(tx.from, this.provider) : undefined)
		});
		if (to != null) {
			tx.to = to;
		}
		if (from != null) {
			tx.from = from;
		}
		if (tx.from != null) {
			ethers.assertArgument(ethers.getAddress(tx.from.toString()) === this.address, "transaction from address mismatch", "tx.from", tx.from);
			delete tx.from;
		}
		// Build the transaction
		const btx = ethers.Transaction.from(tx as ethers.TransactionLike<string>);
		btx.signature = await this._signDigest(btx.unsignedHash);
		return btx.serialized;
	}

	async signMessage(message: string | Uint8Array): Promise<string> {
		return this._signDigest(ethers.hashMessage(message));
	}

	async signTypedData(domain: ethers.TypedDataDomain, types: Record<string, Array<ethers.TypedDataField>>, value: Record<string, any>): Promise<string> {
		// Populate any ENS names
		const populated = await ethers.TypedDataEncoder.resolveNames(domain, types, value, async (name) => {
			// @TODO: this should use resolveName; addresses don't
			//        need a provider
			ethers.assert(this.provider != null, "cannot resolve ENS names without a provider", "UNSUPPORTED_OPERATION", {
				operation: "resolveName",
				info: {name}
			});
			const address = await this.provider?.resolveName(name);
			ethers.assert(address != null, "unconfigured ENS name", "UNCONFIGURED_NAME", {
				value: name
			});
			return address;
		});
		return this._signDigest(ethers.TypedDataEncoder.hash(populated.domain, types, populated.value));
	}

	async _signDigest(hash: string): Promise<string> {
		const rsp = await this.client.post<string>("/sign/eth", {
			digest: hash,
			address: this.address,
		})
		return rsp.data;
	}
}
