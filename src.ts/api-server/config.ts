import * as utils from "../utils/index.js";
import { PrismaClient, t_lp_info } from "@prisma/client";
import { promises as fs } from "fs";
import { ethers } from "ethers";
import { LpInfos } from "./lp-infos.js";
import {
  Backend,
	Config as BackendConfig, getConfig as getBackendConfig,
	loadBackend
} from "../backends/index.js";

async function getLpInfos(db: PrismaClient) {
  const currentVersion = await db.t_counter.findFirst({
    where: {
      id: 2,
    },
  });
  if (currentVersion === null) {
    throw new Error("no current t_lp_info version");
  }
  const version = currentVersion.counter;

  const lpInfos = await db.t_lp_info.findMany({
    where: {
      version: version,
      is_disabled: 0,
    },
  });

  return lpInfos;
}

export interface Config extends BackendConfig {
  lpInfos: LpInfos,
  chainOrderMap: Map<string, number>,
	countPerPage: number;
  gasPassAbiContent: string;
}


async function loadChainSortMap(chainConfig: utils.ChainConfig, path: string) {
  const result = new Map<string, number>();
  const data = await fs.readFile(path, "utf8");
  const lines = data.split("\n")
                .map((line) => line.trim())
                .filter((line) => line.length > 0)
                .filter((line) => !line.includes("#"))

  let order = 1;
  for (const line of lines) {
    if (chainConfig.hasNetworkName(line)) {
      result.set(line, order);
      order = order + 1;
    }
  }
  return result;
}

export async function getConfig(configDir: string): Promise<Config> {
	const config = await getBackendConfig(configDir, 0);
  const lpInfos = new LpInfos(config.chainConfig, config.tokenConfig, await getLpInfos(config.db));
  const chainOrderMap = await loadChainSortMap(config.chainConfig, configDir + "/chain-sort.list");
  const content = await fs.readFile("config/abi/LineaGasPass.json", "utf-8");
	return {
		...config,
    lpInfos: lpInfos,
    chainOrderMap: chainOrderMap,
		countPerPage: 5,
    gasPassAbiContent: content,
	};
}
