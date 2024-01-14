import Ajv from "ajv";
import { JSONSchemaType } from "ajv";
import { promises as fs } from "fs";
import { isLayer1, ChainConfig } from "./chain-config.js"
import { ethers } from "ethers"
import { normalizeAddress } from "./address.js";

export interface TokenInfo {
  symbol: string,
  text: string,
  chainId: number,
  networkName: string,
  address: string,
  baseChainId: number,
  baseAddress: string,
  decimal: number,
  icon: string,
  deprecatedAddress?: string,
}

interface TokenInfoInternal {
  address: string,
  decimal: number,
  icon: string,
  deprecatedAddress?: string,
}

const TokenInfoSchema: JSONSchemaType<TokenInfoInternal> = {
  type: "object",
  properties: {
    address: { type: "string" },
    icon: { type: "string" },
    decimal: { type: "number" },
    deprecatedAddress: { type: "string", nullable: true },
  },
  required: [
    "address",
    "icon",
    "decimal",
  ],
}


function addNativeToken(result: Map<string, Map<string, TokenInfo>>, chainConfig: ChainConfig) {
  for (const [_, info] of chainConfig.chainInfos.entries()) {
    let baseChainId = info.chainId;

    if (info.layer1 !== undefined) {
      baseChainId = chainConfig.getChainIdByName(info.layer1);
    }

    // starknet has no native token
    if (info.name.startsWith("Starknet")) {
      continue;
    }
  
    let symbol = info.gasToken;
    let decimal = info.gasTokenDecimal;
    let icon = "https://owlto.finance/icon/token/eth_logo.png";
    if ( symbol === "BNB" ) {
      icon = "https://owlto.finance/icon/token/bnb_logo.png";
    } else if ( symbol === "MNT" ) {
      icon = "https://owlto.finance/icon/token/bnb_logo.png";
    } else if (symbol === "USDC") {
      icon = "https://owlto.finance/icon/token/USDC.png";
    } else if (symbol === "BTC") {
      icon = "https://owlto.finance/icon/token/BTC.png";
    }
    
    if (!result.has(symbol)) {
      const tmpMap = new Map<string, TokenInfo>();
      result.set(symbol, tmpMap);
    }
    const chain2TokenInfo: Map<string, TokenInfo> = result.get(symbol)!;
    if (chain2TokenInfo.has(info.name)) {
      throw new Error("duplicate token info, symbol=" + symbol + ", chain=" + info.name);
    } else {
      chain2TokenInfo.set(info.name, {
        symbol: symbol,
        text: symbol,
        chainId: info.chainId,
        networkName: info.name,
        address: ethers.ZeroAddress,
        baseChainId: baseChainId,
        baseAddress: ethers.ZeroAddress,
        decimal: decimal,
        icon: icon,
      });
    }
  }
}

export async function parseTokenConfig(file: string, chainConfig: ChainConfig): Promise<TokenConfig> {
  const content = await fs.readFile(file, "utf-8");
  const obj = JSON.parse(content);

  const result = new Map<string, Map<string, TokenInfo>>();
  addNativeToken(result, chainConfig);
  for (const tokenName of Object.keys(obj)) {
    const networks = obj[tokenName];
    let baseAddress: string = result.has(tokenName) ? ethers.ZeroAddress : "";
    let baseChainId: number = 0;
    let tokenMap: Map<string, TokenInfo>;
    if (result.has(tokenName)) {
      tokenMap = result.get(tokenName)!;
    } else {
      tokenMap = new Map<string, TokenInfo>();
    }
    for (const networkName of Object.keys(networks)) {
      const chainInfo = chainConfig.getChainInfoByName(networkName);
      if (chainInfo === undefined) {
        throw new Error("unsupported network " + networkName);
      }
      const chainId = chainInfo.chainId;

      const info = networks[networkName];

      const ajv = new Ajv();
      const validate = ajv.compile(TokenInfoSchema);
      const valid = validate(info);
      if (!valid) {
        throw new Error("token-info config parse error");
      }

      if (isLayer1(chainInfo)) {
        baseAddress = info.address;
      }
      const layer1Info = chainConfig.getLayer1ChainInfoOrSelf(networkName);
      baseChainId = layer1Info.chainId;

      if (baseAddress === "") {
        throw new Error("token-info config no baseAddress");
      }

      let deprecatedAddress: string | undefined = undefined;
      if (info.deprecatedAddress !== undefined) {
        deprecatedAddress = normalizeAddress(info.deprecatedAddress); 
      }
  
      tokenMap.set(networkName, {
        symbol: tokenName,
        text: tokenName,
        networkName: networkName,
        chainId: chainId,
        address: normalizeAddress(info.address),
        baseChainId: baseChainId,
        baseAddress: normalizeAddress(baseAddress),
        decimal: info.decimal,
        icon: info.icon,
        deprecatedAddress: deprecatedAddress,
      });
    }
    result.set(tokenName, tokenMap);
  }
  
  return new TokenConfig(chainConfig, result);
}

export class TokenConfig {
  chainConfig: ChainConfig;
  tokenInfos: Map<string, Map<string, TokenInfo>>;
  tokenList: Array<TokenInfo> = [];
  addressToInfo: Map<string, TokenInfo>;
  infoBySymbolAndChainId = new Map<string, TokenInfo>();
  infoBySymbolAndChainName = new Map<string, TokenInfo>();

  constructor(chainConfig: ChainConfig, info: Map<string, Map<string, TokenInfo>>) {
    this.chainConfig = chainConfig;
    this.tokenInfos = info;
    this.addressToInfo = new Map<string, TokenInfo>();
    this.infoBySymbolAndChainId = new Map<string, TokenInfo>();

    for (const [tokenName, group] of this.tokenInfos.entries()) {
      for (const [networkName, info] of this.tokenInfos.get(tokenName)!.entries()) {
        this.tokenList.push(info);

        const key = info.address.toLowerCase() + "_" + info.chainId;
        this.addressToInfo.set(key, info);

        this.infoBySymbolAndChainId.set(info.symbol + "_" + info.chainId, info);
        this.infoBySymbolAndChainName.set(info.symbol + "_" + networkName, info);
      }
    }
  }

  getAllTokens() {
    return this.tokenList;
  }

  getSymbol(chainId: number, tokenAddress: string): string {
    const key = tokenAddress.toLowerCase() + "_" + chainId;
    const info = this.addressToInfo.get(key);
    if (info === undefined) {
      throw new Error("key not found, key=" + key);
    }
    return info.symbol;
  }

  getInfoByChainIdAndAddress(chainId: number, tokenAddress: string): TokenInfo {
    const key = tokenAddress.toLowerCase() + "_" + chainId;
    const info = this.addressToInfo.get(key);
    if (info === undefined) {
      throw new Error("key not found, key=" + key);
    }
    return info;
  }

  hasInfoBySymbolAndChainId(symbol: string, chainId: number): boolean {
    const key = symbol + "_" + chainId;
    return this.infoBySymbolAndChainId.has(key);
  }

  getInfoBySymbolAndChainId(symbol: string, chainId: number) {
    const key = symbol + "_" + chainId;
    const info = this.infoBySymbolAndChainId.get(key);
    if (info === undefined) {
      throw new Error("key not found, key=" + key);
    }
    return info;
  }

  getInfoBySymbolAndChainName(symbol: string, chainName: string) {
    const key = symbol + "_" + chainName;
    const info = this.infoBySymbolAndChainName.get(key);
    if (info === undefined) {
      throw new Error("key not found, key=" + key);
    }
    return info;
  }

  hasInfoBySymbolAndChainName(symbol: string, chainName: string) {
    const key = symbol + "_" + chainName;
    return this.infoBySymbolAndChainName.has(key);
  }

  getErc20AddressesByNetworkName(name: string): Array<string> {
    const result: Array<string> = [];
    for (const [tokenName, group] of this.tokenInfos.entries()) {
      for (const [networkName, info] of group.entries()) {
        if (networkName === name) {
          result.push(info.address);
        }
      }
    }
    return result;
  }
}
