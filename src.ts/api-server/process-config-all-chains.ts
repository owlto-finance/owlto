import { Config } from "./config.js";
import { URL } from "url";
import http from "http";
import * as utils from "../utils/index.js";

export async function processConfigAllChains(
    config: Config,
    requestUrl: URL,
    res: http.ServerResponse) {

  const chains = getAllChains(config);
  res.writeHead(200, {'Content-Type': 'application/json'});
  res.write(JSON.stringify({code: 0, msg: chains}, null, 4));
  res.end();
  return;
}

export async function processConfigRealAllChains(
    config: Config,
    requestUrl: URL,
    res: http.ServerResponse) {

  const chains = config.chainConfig.getAllChains();
  res.writeHead(200, {'Content-Type': 'application/json'});
  res.write(JSON.stringify({code: 0, msg: chains}, null, 4));
  res.end();
  return;
}

function getAllChains(config: Config) {
  const chainConfig = config.chainConfig;
  const flag = new Map<string, boolean>();

  const chains = [];
  for (const pool of config.lpInfos.lps) {
    const names = [pool.from_chain, pool.to_chain];
    for (const chainName of names) {
      if (!flag.has(chainName)) {
        flag.set(chainName, true);

        const chainInfo = chainConfig.getChainInfoByName(chainName);
        if (chainInfo.fake || !chainInfo.enable) {
          continue;
        }

        let order = 999999;
        if (config.chainOrderMap.has(chainName)) {
          order = config.chainOrderMap.get(chainName)!;
        }

        chains.push({
          name: chainName,
          chainId: chainInfo.chainId,
          isTestnet: chainConfig.isTestnetByChainId(chainInfo.chainId),
          networkCode: chainInfo.networkCode,
          aliasName: chainInfo.aliasName,
          text: chainInfo.aliasName,
          icon: chainInfo.icon,
          explorerUrl: chainInfo.explorerUrl,
          baseChainId: chainInfo.layer1 ? chainConfig.getChainIdByName(chainInfo.layer1) : chainInfo.chainId,
          order: order,
        });
      }
    }
  }

  chains.sort((a, b) => a.order - b.order);
  return chains;
}

