import Ajv from "ajv";
import { JSONSchemaType } from "ajv";
import { ChainConfig } from "./chain-config.js";
import { promises as fs } from "fs";

export interface Network {
  name: string,
  chainId: number,
  tx_enable: boolean,
  log_enable: boolean,
  logFetchBatchNum: number,
  blockFetchBatchNum: number,
}

interface NetworkInternal {
  tx_enable?: boolean,
  log_enable?: boolean,
  logFetchBatchNum: number,
  blockFetchBatchNum: number,
}
const NetworkSchema: JSONSchemaType<NetworkInternal> = {
  type: "object",
  properties: {
    tx_enable: {type: "boolean", nullable: true },
    log_enable: {type: "boolean", nullable: true },
    logFetchBatchNum: { type: "number" },
    blockFetchBatchNum: { type: "number" },
  },
  required: [
    "logFetchBatchNum",
    "blockFetchBatchNum",
  ],
  additionalProperties: false
}

export async function parseNetworkConfig(
    file: string,
    chainConfig: ChainConfig): Promise<Map<string, Network>> {

  const content = await fs.readFile(file, "utf-8");
  const obj = JSON.parse(content);
  if (!("networks" in obj)) {
    throw new Error("No networks in " + file);
  }

  const result = new Map<string, Network>();

  for (const name of Object.keys(obj.networks)) {

    const chainId = chainConfig.getChainIdByName(name);
    if (chainId === undefined) {
      throw new Error(name + " is not a supported network");
    }
    const network = obj.networks[name];

    const ajv = new Ajv();
    const validate = ajv.compile(NetworkSchema);
    const valid = validate(network);
    if (!valid) {
      console.log(validate.errors);
      throw new Error("network config parse error");
    }

    const tx_enable: boolean = "tx_enable" in network ? network.tx_enable as boolean : true;
    const log_enable: boolean = "log_enable" in network ? network.log_enable as boolean : true;
    
    result.set(name, {
      name: name,
      chainId: chainId as number,
      tx_enable: tx_enable,
      log_enable: log_enable,
      logFetchBatchNum: network.logFetchBatchNum as number,
      blockFetchBatchNum: network.blockFetchBatchNum as number,
    });
  }

  return result;
}
