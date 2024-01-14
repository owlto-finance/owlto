import Ajv from "ajv";
import { JSONSchemaType } from "ajv";
import { promises as fs } from "fs";
import { ChainConfig } from "./chain-config.js";

// struct on LPManager smart contract
export interface Pool {
  lpId: string,
  maker: string,
  baseChainId: number,
  baseTokenAddress: string,
  token1_chainId: number,
  token1_tokenAddress: string,
  token2_chainId: number,
  token2_tokenAddress: string,
  gasCompensation: bigint,
}

export interface LpInfo {
  env: string,
  network: string,
  address: string,
  abiPath: string
}

interface LpInfoInternal {
  network: string,
  address: string,
  abiPath: string,
}

const LpInfoSchema: JSONSchemaType<LpInfoInternal> = {
  type: "object",
  properties: {
    network: { type: "string" },
    address: { type: "string" },
    abiPath: { type: "string" },
  },
  required: [
    "network",
    "address",
    "abiPath",
  ]
}

export async function parseLpConfig(dir: string, chainConfig: ChainConfig) {
  const content = await fs.readFile(dir + "/lp.json", "utf-8");
  const obj = JSON.parse(content);

  const result = new Map<string, LpInfo>();
  for (const env of Object.keys(obj)) {
    if (env != "dev" && env != "test" && env != "prod") {
      throw new Error("env is invalid, env=" + env);
    }

    const lpInfo = obj[env];

    const ajv = new Ajv();
    const validate = ajv.compile(LpInfoSchema);
    const valid = validate(lpInfo);
    if (!valid) {
      throw new Error("lp config parse error");
    }
    result.set(env, {
      env: env,
      network: lpInfo.network,
      address: lpInfo.address,
      abiPath: lpInfo.abiPath,
    })
  }

  return new LpConfig(result, chainConfig);
}

export class LpConfig {
  lpInfos: Map<string, LpInfo>;
  chainConfig: ChainConfig;

  constructor(infos: Map<string, LpInfo>, chainConfig: ChainConfig) {
    this.lpInfos = infos;
    this.chainConfig = chainConfig;
  }

  getLpInfo(env: string) {
    return this.lpInfos.get(env);
  }
}
