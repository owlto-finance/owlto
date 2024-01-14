import Ajv from "ajv";
import { JSONSchemaType } from "ajv";
import { promises as fs } from "fs";
import { ethers } from "ethers";
import { PrismaClient } from "@prisma/client";
import { ChainConfig } from "./chain-config.js";

export interface ClaimInfo {
  networkName: string,
  address: string,
  env: string,
  symbol: string,
}

interface ClaimInfoInternal {
  chainName: string,
  address: string,
}

const ClaimInfoSchema: JSONSchemaType<ClaimInfoInternal> = {
  type: "object",
  properties: {
    chainName: { type: "string" },
    address: { type: "string" },
  },
  required: [
    "chainName",
    "address",
  ]
}

export async function parseClaimConfig(dir: string, chainConfig: ChainConfig): Promise<ClaimConfig> {
  const content = await fs.readFile(dir, "utf-8");
  const obj = JSON.parse(content);

  const result = new Map<string, Map<string, ClaimInfo>>();
  for (const envName of Object.keys(obj)) {
    const envs = obj[envName];
    const claimMap = new Map<string, ClaimInfo>();

    for (const symbol of Object.keys(envs)) {
      const info = envs[symbol];

      const ajv = new Ajv();
      const validate = ajv.compile(ClaimInfoSchema);
      const valid = validate(info);
      if (!valid) {
        console.log(validate.errors);
        throw new Error("chain-info config parse error");
      }

      claimMap.set(symbol, {
        networkName: info.chainName,
        address: info.address,
        env: envName,
        symbol: symbol,
      });
    }
    result.set(envName, claimMap);
  }

  return new ClaimConfig(chainConfig, result);
}

export class ClaimConfig {
  chainConfig: ChainConfig;
  claimInfos: Map<string, Map<string, ClaimInfo>>;
  infoByEnvAndSymbol = new Map<string, ClaimInfo>();

  constructor(chainConfig: ChainConfig, info: Map<string, Map<string, ClaimInfo>>) {
    this.chainConfig = chainConfig;
    this.claimInfos = info;
    this.infoByEnvAndSymbol = new Map<string, ClaimInfo>();

    for (const [envName, group] of this.claimInfos.entries()) {
      for (const [tokenName, info] of this.claimInfos.get(envName)!.entries()) {
        this.infoByEnvAndSymbol.set(envName + "_" + tokenName, info);
      }
    }
  }

  getInfoByEnvAndSymbol(env: string, symbol: string) {
    const key = env + "_" + symbol;
    const info = this.infoByEnvAndSymbol.get(key);
    if (info === undefined) {
      throw new Error("key not found, key=" + key);
    }
    return info;
  }

  getNetworkName(env: string, symbol: string): string {
    const info = this.getInfoByEnvAndSymbol(env, symbol);
    return info.networkName;
  }

  getChainIdByEnvAndSymbol(env: string, symbol: string): number {
    const info = this.getInfoByEnvAndSymbol(env, symbol);
    const chainId = this.chainConfig.getChainIdByName(info.networkName);
    return chainId;
  }

  getAddress(env: string, token: string): string {
    const info = this.getInfoByEnvAndSymbol(env, token);
    return info.address;
  }
}
