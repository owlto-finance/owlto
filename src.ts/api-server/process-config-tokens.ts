import { Config } from "./config.js";
import { URL } from "url";
import http from "http";
import * as utils from "../utils/index.js";

export async function processConfigTokensV2(
    config: Config,
    requestUrl: URL,
    res: http.ServerResponse) {

  const params = requestUrl.searchParams;

  let baseChainId: number = 1;
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

  const tokens = config.lpInfos.getTokens(baseChainId);

  res.writeHead(200, {'Content-Type': 'application/json'});
  res.write(JSON.stringify({code: 0, msg: tokens}, null, 4));        
  res.end();
  return;
}
