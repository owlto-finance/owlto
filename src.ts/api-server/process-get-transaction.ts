import { Config } from "./config.js";
import { URL } from "url";
import http from "http";
import { loadBackend } from "../backends/index.js";

// api/get-transaction?chainid=xx&tx_hash=xx
export async function processGetTransaction(
    config: Config,
    requestUrl: URL,
    res: http.ServerResponse) {

  const params = requestUrl.searchParams;
  if (params.has("chainid") &&
      params.has("tx_hash")) {
    
    const chainId = parseInt(params.get("chainid")!);
    const tx_hash: string = params.get("tx_hash")!;

    if (tx_hash == "") {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.write(JSON.stringify({code: -6, msg: "query params error"}));
      res.end();
      return;
    }

    const chainInfo = config.chainConfig.getChainInfoByChainId(chainId);
    const backend = await loadBackend(config, chainInfo.name);

    const nonce = await backend.getTxNonce(tx_hash);
    if (nonce === null) {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.write(JSON.stringify({code: -1, msg: "tx is null"}));
      res.end();
      return;
    } else {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.write(JSON.stringify({code: 0, msg: { nonce: nonce }}));
      res.end();
      return;
    }
  } else {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.write(JSON.stringify({code: -6, msg: "query params error"}));
    res.end();
    return;
  }
}

