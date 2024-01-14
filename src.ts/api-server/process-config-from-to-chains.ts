import { Config } from "./config.js";
import { URL } from "url";
import http from "http";
import * as utils from "../utils/index.js";
import { t_lp_info } from "@prisma/client";

interface Pair {
  symbol: string,
  decimal: number,
  fromChainId: number,
  fromAddress: string,
  toChainId: number,
  toAddress: string,
  minValue: number,
  maxValue: number,
}

function addPair(
    config: Config,
    symbol: string,
    decimal: number,
    pool: t_lp_info,
    result: Array<Pair>) {

  const fromChainName = pool.from_chain;
  const toChainName = pool.to_chain;
  const fromChainInfo = config.chainConfig.getChainInfoByName(fromChainName);
  const toChainInfo = config.chainConfig.getChainInfoByName(toChainName);

  const fromTokenInfo = config.tokenConfig.getInfoBySymbolAndChainName(symbol, fromChainName);
  const toTokenInfo = config.tokenConfig.getInfoBySymbolAndChainName(symbol, toChainName);

  result.push({
    symbol: symbol,
    decimal: decimal,
    fromChainId: fromChainInfo.chainId,
    fromAddress: fromTokenInfo.address,
    toChainId: toChainInfo.chainId,
    toAddress: toTokenInfo.address,
    minValue: parseFloat(pool.min_value),
    maxValue: parseFloat(pool.max_value),
  });
}
    
export async function processConfigFromToChainsV2(
    config: Config,
    requestUrl: URL,
    res: http.ServerResponse) {
  const params = requestUrl.searchParams;
  if (!params.has("token")) {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.write(JSON.stringify({code: -2, msg: "params invalid"}, null, 4));
    res.end();
    return;
  }

  const token: string = params.get("token")!;

  let baseChainId = 1;
  if (params.has("base_chainid")) {
    baseChainId = parseInt(params.get("base_chainid")!);
  } else if (params.has("chainid")) {
    const chainid = parseInt(params.get("chainid")!);
    const baseChainInfo = config.chainConfig.getLayer1ChainInfoOrSelfByChainId(chainid);
    baseChainId = baseChainInfo.chainId;
  } else {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.write(JSON.stringify({code: -6, msg: "query params error"}));     
    res.end();
    return;
  }

  const chains = getFromToChainsV2(config, baseChainId, token);
  res.writeHead(200, {'Content-Type': 'application/json'});
  res.write(JSON.stringify({code: 0, msg: chains}, null, 4));
  res.end();

  return;
}

export async function processConfigFromToChainsV3(
    config: Config,
    requestUrl: URL,
    res: http.ServerResponse) {
  const params = requestUrl.searchParams;
  if (params.has("token") || params.has("from") || params.has("to")) {
    let baseChainId = 1;
    if (params.has("base_chainid")) {
      baseChainId = parseInt(params.get("base_chainid")!);
    } else if (params.has("chainid")) {
      const chainid = parseInt(params.get("chainid")!);
      const baseChainInfo = config.chainConfig.getLayer1ChainInfoOrSelfByChainId(chainid);
      baseChainId = baseChainInfo.chainId;
    } else {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.write(JSON.stringify({code: -6, msg: "query params error"}));     
      res.end();
      return;
    }

    const token: string | null = params.has("token") ? params.get("token")! : null;
    const fromChainNameStr: string | null = params.has("from") ? params.get("from")! : null;
    const toChainNameStr: string | null = params.has("to") ? params.get("to")! : null;

    const chains = getFromToChainsV3(config, baseChainId, token, fromChainNameStr, toChainNameStr);
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.write(JSON.stringify({code: 0, msg: chains}, null, 4));
    res.end();
    return;
  } else {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.write(JSON.stringify({code: -2, msg: "params invalid"}, null, 4));
    res.end();
    return;
  }

}



function getOrder(config: Config, chainName: string) {
  let order = 99999;
  if (config.chainOrderMap.has(chainName)) {
    order = config.chainOrderMap.get(chainName)!;
  }
  return order;
}

function getFromToChainsV3(
    config: Config,
    baseChainId: number,
    baseTokenNameStr: string | null,
    fromChainNameStr: string | null,
    toChainNameStr: string | null) {

  const result: Array<Pair> = [];

  const lps = config.lpInfos.lps;
  lps.sort((a, b) => {
    const aFromChain = a.from_chain;
    const aToChain = a.to_chain;
    const aFromOrder = getOrder(config, aFromChain);
    const aToOrder = getOrder(config, aToChain);

    const bFromChain = b.from_chain;
    const bToChain = b.to_chain;
    const bFromOrder = getOrder(config, bFromChain);
    const bToOrder = getOrder(config, bToChain);
    
    const fromDiff = aFromOrder - bFromOrder;
    if (fromDiff != 0) {
      return fromDiff;
    }

    return aToOrder - bToOrder;
  });

  const isTestnet = config.chainConfig.isTestnetByChainId(baseChainId);

  for (const pool of lps) {
    const fromChainName = pool.from_chain;
    const isSameNet = config.chainConfig.isTestnet(fromChainName) === isTestnet;
    if (isSameNet) {
      if (baseTokenNameStr != null && pool.token_name !== baseTokenNameStr.toUpperCase()) {
        continue;
      }
      if (fromChainNameStr != null && fromChainName != fromChainNameStr) {
        continue;
      }
      if (toChainNameStr != null && pool.to_chain != toChainNameStr) {
        continue;
      }

      const tokenInfo = config.tokenConfig.getInfoBySymbolAndChainName(pool.token_name, fromChainName);
      const symbol = tokenInfo.symbol;
      const decimal = tokenInfo.decimal;
      addPair(config, symbol, decimal, pool, result);
    }
  }

  return result;
}

function getFromToChainsV2(
    config: Config,
    baseChainId: number,
    baseTokenNameStr: string) {

  const baseTokenName = baseTokenNameStr.toUpperCase();
  const tokenInfo = config.tokenConfig.getInfoBySymbolAndChainId(baseTokenName, baseChainId);

  const address = tokenInfo.address;
  const symbol = tokenInfo.symbol;
  const decimal = tokenInfo.decimal;

  const result: Array<Pair> = [];

  const lps = config.lpInfos.lps;
  lps.sort((a, b) => {
    const aFromChain = a.from_chain;
    const aToChain = a.to_chain;
    const aFromOrder = getOrder(config, aFromChain);
    const aToOrder = getOrder(config, aToChain);

    const bFromChain = b.from_chain;
    const bToChain = b.to_chain;
    const bFromOrder = getOrder(config, bFromChain);
    const bToOrder = getOrder(config, bToChain);

    const fromDiff = aFromOrder - bFromOrder;
    if (fromDiff !== 0) {
      return fromDiff;
    }

    return aToOrder - bToOrder;
  });

  const isTestnet = config.chainConfig.isTestnetByChainId(baseChainId);

  for (const pool of lps) {
    const fromChainName = pool.from_chain;
    const isSameNet = config.chainConfig.isTestnet(fromChainName) === isTestnet;
    if (isSameNet && pool.token_name === baseTokenName) {
      addPair(config, symbol, decimal, pool, result);
    }
  }

  return result;
}
