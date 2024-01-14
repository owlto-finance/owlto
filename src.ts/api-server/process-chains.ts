import { Config } from "./config.js";
import { URL } from "url";
import http from "http";
import * as utils from "../utils/index.js";
import { PrismaClient } from "@prisma/client";

// fee = gas * gas_price * eth_price
export async function processChains(config: Config, requestUrl: URL, res: http.ServerResponse) {
  const params = requestUrl.searchParams;
  if (params.has("chainid")) {
    const chainId = parseInt(params.get("chainid")!);
    const info = config.chainConfig.getChainInfoByChainId(chainId);
    if (info === undefined) {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.write(JSON.stringify({code: -2, msg: "no such chain"}));
      res.end();
    } else {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.write(JSON.stringify({code: 0, msg: info}));
      res.end();
    }
  } else {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.write(JSON.stringify({code: 0, msg: Object.fromEntries(config.chainConfig.chainInfos)}));
    res.end();
  }
}


