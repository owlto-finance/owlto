
import Ajv from "ajv";
import { JSONSchemaType } from "ajv";
import { promises as fs } from "fs";
import { ethers } from "ethers";
import { MakerConfig } from "./maker-config.js";

export interface ChainInfo {
  name: string,
  chainId: number,
  networkCode: number,
  aliasName: string,
  blockInterval: number,
  icon: string,
  rpcUrl: string,
  explorerUrl: string,
  transferEthGas: number,
  transferErc20Gas: number,
  depositGas?: number,
  withdrawGas?: number,
  mainnet?: string,
  layer1?: string,
  fake?: boolean,
  enable?: boolean,
  gasToken: string,
  gasTokenDecimal: number,
  backend: string,
  transferContractAddress?: string,
}

export function isLayer1(info: ChainInfo): boolean {
  if (info.layer1 === undefined) {
    return true;
  }
  return false;
}

function buildNameByChainId(chainInfos: Map<string, ChainInfo>): Map<number, string> {
  const result = new Map<number, string>();
  for (const [name, info] of chainInfos) {
      result.set(info.chainId, info.name);
  }
  return result;
}

function buildChainIdByNetworkCode(chainInfos: Map<string, ChainInfo>): Map<number, number> {
  const result = new Map<number, number>();
  for (const [name, info] of chainInfos) {
      result.set(info.networkCode, info.chainId);
  }
  return result;
}

interface ProviderAndTimestamp {
  provider: ethers.Provider,
  timestamp: number, // cache duration
}

export class ChainConfig {
  chainInfos: Map<string, ChainInfo>;
  nameByChainId: Map<number, string>;
  chainIdByNetworkCode: Map<number, number>;
  makerConfig: MakerConfig;
  providerByName = new Map<string, ProviderAndTimestamp>();

  constructor(info: Map<string, ChainInfo>, makerConfig: MakerConfig) {
    this.makerConfig = makerConfig;
    this.chainInfos = info;

    this.nameByChainId = buildNameByChainId(this.chainInfos);

    this.chainIdByNetworkCode = buildChainIdByNetworkCode(this.chainInfos);
    //this.chainIdByAliasName = buildMap<number, string>(chainInfos, "chainId", "aliasName");

    //this.networkCodeByName = buildMap<string, number>(chainInfos, "name", "networkCode");
    //this.nameByNetworkCode = buildMap<number, string>(chainInfos, "networkCode", "name");
  }

  isEnabledByChainId(chainId: number): boolean {
    const name = this.nameByChainId.get(chainId);
    if (name === undefined) {
      throw new Error("unsupported chainid, chainid=" + chainId);
    }
    const info = this.chainInfos.get(name);
    if (info === undefined) {
      throw new Error("unsupported name, networkName=" + name);
    }

    const enable = info.enable!;
    if (enable === undefined) {
      throw new Error("enable is not set, networkName=" + name);
    }

    return enable;
  }
  
  getNameByChainId(chainId: number): string {
    const name = this.nameByChainId.get(chainId);
    if (name === undefined) {
      throw new Error("unsupported chainid, chainid=" + chainId);
    }
    return name;
  }

  getChainInfoByChainId(chainId: number): ChainInfo {
    const name = this.getNameByChainId(chainId);
    if (name === undefined) {
      throw new Error("unsupported chainid, chainid=" + chainId);
    }
    const info = this.chainInfos.get(name);
    if (info === undefined) {
      throw new Error("unsupported name, networkName=" + name);
    }

    return info;
  }

  getChainInfoByName(name: string): ChainInfo {
    const info = this.chainInfos.get(name);
    if (info === undefined) {
      throw new Error("unsupported chain, name=" + name);
    }
    return info;
  }

  getChainIdByName(name: string): number {
    const info = this.chainInfos.get(name);
    if (info === undefined) {
      throw new Error("unsupported chain, name=" + name);
    }
    return info.chainId;
  }

  getProviderByName(name: string): ethers.Provider {
    const now = Math.floor(Date.now() / 1000);
    if (this.providerByName.has(name)) {
      const result: ProviderAndTimestamp = this.providerByName.get(name)!;
      return result.provider;
    }

    const info = this.chainInfos.get(name);
    if (info === undefined) {
      throw new Error("unsupported network, name=" + name);
    }

    const provider = new ethers.JsonRpcProvider(info.rpcUrl);
    this.providerByName.set(name, { provider: provider, timestamp: now });

    return provider;
  }

  getProviderByChainId(chainId: number) {
    const name = this.nameByChainId.get(chainId);
    if (name === undefined) {
      throw new Error("unsupported chainid, chainid=" + chainId);
    }
    return this.getProviderByName(name);
  }

  isTestnetByChainId(chainId: number): number {
    const name = this.getNameByChainId(chainId);
    return this.isTestnet(name);
  }

  isTestnet(name: string): number {
    const info = this.chainInfos.get(name);
    if (info === undefined) {
      throw new Error("unsupported network " + name);
    } else {
      if (info.mainnet === undefined) {
        return 0;
      } else {
        return 1;
      }
    }
  }

  getLayer1ChainInfoOrSelfByChainId(chainid: number) {
    const info = this.getChainInfoByChainId(chainid);
    if (info.layer1 === undefined) {
      return info;
    }
    return this.getChainInfoByName(info.layer1);
  }

  getLayer1ChainInfoOrSelf(name: string) {
    const info = this.getChainInfoByName(name);
    if (info.layer1 === undefined) {
      return info;
    }
    return this.getChainInfoByName(info.layer1);
  }

  getLayer1NetworkOrSelf(name: string): string {
    const info = this.getChainInfoByName(name);
    if (info.layer1 === undefined) {
      return info.name;
    }
    return info.layer1;
  }

  getChainIdByNetworkCode(code: number): number {
    const chainId = this.chainIdByNetworkCode.get(code);
    if (chainId === undefined) {
      throw new Error("unsupported code, code=" + code);
    }
    return chainId;
  }

  hasChainId(chainId: number): boolean {
    return this.nameByChainId.has(chainId);
  }

  hasNetworkCode(code: number) {
    return this.chainIdByNetworkCode.has(code);
  }

  getChainIdByValue(value: bigint): number {
    const valueStr = value.toString();
    if (valueStr.length < 5) {
      throw new Error("value length is less than 8");
    }
    const last4Num = parseInt(valueStr.slice(-4), 10);
    return this.getChainIdByNetworkCode(last4Num);
  }

  hasNetworkName(name: string) {
    return this.chainInfos.has(name);
  }


  getMainnetByName(name: string) {
    const info = this.chainInfos.get(name);
    if (info === undefined) {
      return undefined;
    }
    return info.mainnet;
  }

  getAllChainInfos() {
    const chains: Array<ChainInfo> = [];
    for (const [networkName, info] of this.chainInfos.entries()) {
      if (info.fake) {
        continue;
      }
      chains.push(info);
    }
    return chains;
  }

  getAllChains() {
    const chains = [];
    for (const [networkName, info] of this.chainInfos.entries()) {
      if (info.fake) {
        continue;
      }
      let isTestnet = 1;
      if (info.mainnet === undefined) {
        isTestnet = 0;
      }
      chains.push({
        name: info.name,
        chainId: info.chainId,
        isTestnet: isTestnet,
        networkCode: info.networkCode,
        aliasName: info.aliasName,
        text: info.aliasName,
        icon: info.icon,
        explorerUrl: info.explorerUrl,
        baseChainId: info.layer1 ? this.getChainIdByName(info.layer1) : info.chainId,
        //transferEthGas: info.transferEthGas,
        //transferErc20Gas: info.transferErc20Gas,
      });
    }
    return chains;
  }

  getLeastBlockInterval(): number {
    let leastBlockInterval = 5000000000;
    for (const [name, chain] of this.chainInfos) {
      if (chain.blockInterval < leastBlockInterval) {
        leastBlockInterval = chain.blockInterval;
      }
    }
    if (leastBlockInterval === 5000000000) {
      leastBlockInterval = 0;
    }

    return leastBlockInterval;
  }

  getSleepTime(): number {
    let interval = this.getLeastBlockInterval();
    if (interval < 10) {
      interval = 10;
    }
    return Math.floor(interval / 2);
  }
  //getAliasNameByChainId(chainId: number): string;
  //getChainIdByAliasName(aliasName: string): number;

  //getNetworkCodeByName(name: string): number;
  //getNameByNetworkCode(code: number): string;
  
  getTransferContractAddressByNetworkName(name: string) {
    const info = this.chainInfos.get(name);
    if (info === undefined) {
      throw new Error("unsupported network " + name);
    }
    return info.transferContractAddress;
  }
}

interface ChainInfoInternal {
  chainId: number,
  networkCode: number,
  aliasName: string,
  blockInterval: number,
  icon: string,
  rpcUrl: string,
  explorerUrl: string,
  transferEthGas: number,
  transferErc20Gas: number,
  depositGas?: number,
  withdrawGas?: number,
  mainnet?: string
  layer1?: string
  fake?: boolean,
  enable?: boolean,
  gasToken: string,
  gasTokenDecimal: number,
  backend?: string,
  transferContractAddress?: string,
}

const ChainInfoSchema: JSONSchemaType<ChainInfoInternal> = {
  type: "object",
  properties: {
    chainId: { type: "number" },
    networkCode: { type: "number" },
    aliasName: { type: "string" },
    blockInterval: { type: "number" },
    icon: { type: "string" },
    rpcUrl: { type: "string" },
    explorerUrl: { type: "string" },
    transferEthGas: { type: "number" },
    transferErc20Gas: { type: "number" },
    depositGas: { type: "number", nullable: true },
    withdrawGas: { type: "number", nullable: true },
    mainnet: { type: "string", nullable: true },
    layer1: { type: "string", nullable: true },
    fake: { type: "boolean", nullable: true },
    enable: { type: "boolean", nullable: true },
    gasToken: { type: "string" },
    gasTokenDecimal: { type: "number" },
	  backend: { type: "string", nullable: true },
    transferContractAddress: { type: "string", nullable: true },
  },
  required: [
    "chainId",
    "networkCode",
    "aliasName",
    "icon",
    "rpcUrl",
    "explorerUrl",
    "transferEthGas",
    "transferErc20Gas",
    "gasToken",
  ],
}

export async function parseChainConfig(file: string, makerConfig: MakerConfig): Promise<ChainConfig> {
  const content = await fs.readFile(file, "utf-8");
  const obj = JSON.parse(content);

  const result = new Map<string, ChainInfo>();
  for (const name of Object.keys(obj)) {
    const chainInfo = obj[name];

    // validate the schema of chain info item
    const ajv = new Ajv();
    const validate = ajv.compile(ChainInfoSchema);
    const valid = validate(chainInfo);
    if (!valid) {
      console.log(validate.errors);
      throw new Error("chain-info config parse error");
    }

    let fake = false;
    if (chainInfo.fake !== undefined && chainInfo.fake === true) {
      fake = true;
    }
    
    let enable = true; 
    if (chainInfo.enable !== undefined && chainInfo.enable === false) { 
      enable = false;
    }

    if (chainInfo.layer1 !== undefined) {
      if (name.endsWith("Mainnet") && !chainInfo.layer1.endsWith("Mainnet")) {
        throw new Error(name + "'s layer1 should be mainnet");
      }
    }

    let backend = "ethers";
    if (chainInfo.backend !== undefined) {
      backend = chainInfo.backend;
    }

    result.set(name, {
      name: name,
      chainId: chainInfo.chainId as number,
      networkCode: chainInfo.networkCode as number,
      aliasName: chainInfo.aliasName as string,
      blockInterval: chainInfo.blockInterval as number,
      icon: chainInfo.icon as string,
      rpcUrl: chainInfo.rpcUrl as string,
      explorerUrl: chainInfo.explorerUrl as string,
      transferEthGas: chainInfo.transferEthGas as number,
      transferErc20Gas: chainInfo.transferErc20Gas as number,
      depositGas: chainInfo.depositGas,
      withdrawGas: chainInfo.withdrawGas,
      mainnet: chainInfo.mainnet,
      layer1: chainInfo.layer1,
      fake: fake,
      enable: enable,
      gasToken: chainInfo.gasToken,
      gasTokenDecimal: chainInfo.gasTokenDecimal,
      backend: backend,
      transferContractAddress: chainInfo.transferContractAddress,
    });
  }

  // TODO: check uniqueness of ChainInfo field
  return new ChainConfig(result, makerConfig);
}
