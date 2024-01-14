import { Config } from "./config.js";
import { URL } from "url";
import http from "http";
import { ethers } from "ethers";
import * as utils from "../utils/index.js";
import { loadBackend } from "../backends/index.js";

// api/src-tx?chainid=xx&nonce=xx&tx_hash=xx
export async function processTxSrc(
    config: Config,
    requestUrl: URL,
    res: http.ServerResponse) {

  utils.log("request url:", requestUrl.toString());
  const params = requestUrl.searchParams;
  if (params.has("chainid") &&
      params.has("user") &&
      params.has("tx_hash")) {
    
    const userTmp: string = params.get("user")!;
    if (userTmp.length < 5) {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.write(JSON.stringify({code: -6, msg: { status: "user address is invalid"}}));
      res.end();
      return;
    }

    const user = utils.normalizeAddress(userTmp);

    const chainId = parseInt(params.get("chainid")!);
    let nonce = -1;
    if (params.has("nonce")) {
      nonce = parseInt(params.get("nonce")!);
    }
    let tx_hash = params.get("tx_hash")!;

    if (nonce >= 0) {
      const item = await config.bdb3.t_src_transaction.findFirst({
        where: {
          chainid: chainId,
          src_nonce: nonce,
          sender: user,
        },
      });

      if (item != null) {
        tx_hash = item!.tx_hash;
      }
    }
    utils.log("chainId:", chainId, "nonce:", nonce, "tx_hash:", tx_hash);

    if (tx_hash.length < 10) {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.write(JSON.stringify({code: -6, msg: { status: "tx_hash is invalid"}}));
      res.end();
      return;
    }

    const chainInfo = config.chainConfig.getChainInfoByChainId(chainId);
    const srcBackend = await loadBackend(config, chainInfo.name);

    const status = await srcBackend.getTxStatus(tx_hash);
    utils.log("status:", status);
    if (status === null) {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.write(JSON.stringify({code: 0, msg: { status: "pending or fail"}}));
      res.end();
      return;
    } else if (!status) {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.write(JSON.stringify({code: 0, msg: { status: "error"}}));
      res.end();
      return;
    }

    res.writeHead(200, {'Content-Type': 'application/json'});
    res.write(JSON.stringify({code: 0, msg: { status: "success" }}));
    res.end();
    return;

  } else {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.write(JSON.stringify({code: -6, msg: "query params error"}));
    res.end();
    return;
  }
}

