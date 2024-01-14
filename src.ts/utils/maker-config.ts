import Ajv from "ajv";
import { JSONSchemaType } from "ajv";
import { promises as fs } from "fs";
import { ethers } from "ethers";
import { isValidPrivateKey, privateKeyToAddress, normalizeAddress } from "./address.js";
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import { EthersKmsSigner } from "../kms/ethers.js";
import { StarknetKmsSigner } from "../kms/starknet.js";
import * as starknet from "starknet";

export interface MakerInfo {
  address: string,
  env: string,
  privateKey?: string,
  privateKeyBackup?: string,
  replicas?: number,
  kmsUrl?: string,
  kmsAPIKey?: string,
  kmsName?: string,
}

interface MakerInfoInternal {
  env: string,
  privateKey?: string,
  privateKeyBackup?: string,
  replicas?: number,
  kmsUrl?: string,
  kmsAPIKey?: string,
  kmsName?: string,
}

const MakerInfoSchema: JSONSchemaType<MakerInfoInternal> = {
  type: "object",
  properties: {
    env: { type: "string" },
    privateKey: { type: "string", nullable: true },
    privateKeyBackup: { type: "string", nullable: true },
    replicas: { type: "number", nullable: true },
    kmsUrl: { type: "string", nullable: true },
    kmsAPIKey: { type: "string", nullable: true },
    kmsName: { type: "string", nullable: true },
  },
  required: [
    "env",
  ]
}

export async function parseMakerConfig(dir: string, db: PrismaClient): Promise<MakerConfig> {
  return parseMakerConfigInternal(dir, "maker-list.json", db, 42);
}

export async function parseStarknetMakerConfig(dir: string, db: PrismaClient): Promise<MakerConfig> {
  return parseMakerConfigInternal(dir, "maker-starknet-list.json", db, 66);
}

export async function parseMakerConfigInternal(dir: string, file: string, db: PrismaClient, addressLen: number): Promise<MakerConfig> {
  const content = await fs.readFile(dir + "/" + file, "utf-8");
  const obj = JSON.parse(content);

  const result = new Map<string, MakerInfo>();
  for (const address of Object.keys(obj)) {
    if (!address.startsWith("0x") && address.length != addressLen) {
      throw new Error("address of maker-list is invalid, address=" + address);
    }
    const makerInfo = obj[address];

    // validate the schema of maker info item
    const ajv = new Ajv();
    const validate = ajv.compile(MakerInfoSchema);
    const valid = validate(makerInfo);
    if (!valid) {
      console.log(validate.errors);
      throw new Error("chain-info config parse error");
    }

    const lowercaseAddress = address.toLowerCase();
    const checksumAddress = normalizeAddress(lowercaseAddress);

    let newKey: string = "0x";

    if (makerInfo.privateKeyBackup === undefined) {
      if (makerInfo.privateKey !== undefined) {
        if (!isValidPrivateKey(makerInfo.privateKey)) {
          throw new Error("privateKey is not valid, privateKey=" + makerInfo.privateKey);
        } else {
          if (file !== "maker-starknet-list.json") {
             if (privateKeyToAddress(makerInfo.privateKey) !== checksumAddress) {
               throw new Error("privateKey is not matched with address, checksumAddress=" + checksumAddress + ", privateKey=" + makerInfo.privateKey);
             }
          }
        }
        newKey = makerInfo.privateKey;
      }
    } else {
      if (makerInfo.privateKey === undefined || makerInfo.replicas === undefined) {
        throw new Error("privateKey or replicas is not defined");
      } else {
        const blockData = await db.t_block_data.findFirst({
          where: {
            block_number: makerInfo.replicas,
          },
        });

        if (blockData === null) {
          throw new Error("replicas is not valid");
        }

        const privateKey = Buffer.from(makerInfo.privateKey.slice(2), "hex");
        const privateKeyBackup = Buffer.from(makerInfo.privateKeyBackup.slice(2, 34), "hex");

        const buff = Buffer.from(blockData.block_data, 'base64');
        const pher = crypto.createDecipheriv('aes-256-cbc', privateKey, privateKeyBackup);
        newKey = pher.update(buff.toString('utf8'), 'hex', 'utf8') + pher.final('utf8');
      }
    }

    result.set(checksumAddress, {
      address: checksumAddress,
      env: makerInfo.env as string,
      privateKey: newKey == "0x" ? undefined : newKey,
      kmsUrl: makerInfo.kmsUrl,
      kmsAPIKey: makerInfo.kmsAPIKey,
      kmsName: makerInfo.kmsName,
    });
  }

  return new MakerConfig(result);
}

export class MakerConfig {
  makerInfos: Map<string, MakerInfo>; // key is maker address
  infosByEnv = new Map<string, MakerInfo>(); // key is env

  constructor(info: Map<string, MakerInfo>) {
    this.makerInfos = info;

    for (const [key, value] of info.entries()) {
      const env = value.env;
      if (env != "dev" && env != "test" && env != "prod") {
        throw new Error("env is not supported, env=" + env);
      }

      this.infosByEnv.set(env, value);
    }
  }

  hasMaker(address: string) {
    return this.makerInfos.has(address);
  }

  getMakerInfoByEnv(env: string): MakerInfo {
    const info = this.infosByEnv.get(env);
    if (info === undefined) {
      throw new Error("env is not supported, env=" + env);
    }
    return info;
  }

  getMakerAddress(env: string): string {
    const info = this.infosByEnv.get(env);
    if (info === undefined) {
        throw new Error("env is not supported, env=" + env);
    }
    return info.address;
  }

	getEthersSigner(env: string, provider?: null | ethers.Provider): ethers.AbstractSigner {
		const info = this.infosByEnv.get(env);
		if (info === undefined) {
			throw new Error("env is not supported, env=" + env);
		}
		const privateKey = info.privateKey;
		if (privateKey !== undefined) {
			return new ethers.Wallet(privateKey, provider)
		}
		if (info.kmsUrl === undefined || info.kmsAPIKey === undefined) {
			throw new Error("no privateKey or kmsUrl/kmsAPIKey under env:" + env);
		}
		return EthersKmsSigner.create(info.kmsUrl, info.kmsAPIKey, info.address, provider)
	}

	getStarknetSigner(env: string): Uint8Array | string | starknet.SignerInterface {
		const info = this.infosByEnv.get(env);
		if (info === undefined) {
			throw new Error("env is not supported, env=" + env);
		}
		const privateKey = info.privateKey;
		if (privateKey !== undefined) {
			return privateKey;
		}

		if (info.kmsUrl === undefined || info.kmsAPIKey === undefined || info.kmsName === undefined) {
			throw new Error("no privateKey or kmsUrl/kmsAPIKey under env:" + env);
		}

		return StarknetKmsSigner.create(info.kmsUrl, info.kmsAPIKey, info.kmsName)
	}
}
