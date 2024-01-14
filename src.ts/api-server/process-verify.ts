import { Config } from "./config.js";
import { URL } from "url";
import http from "http";
import * as utils from "../utils/index.js";
import { PrismaClient } from "@prisma/client";
import { ethers } from "ethers";
 import { promises as fs } from "fs";

export async function processVerify(config: Config, requestUrl: URL, res: http.ServerResponse) {
  const params = requestUrl.searchParams;

  if (params.has("chainid") &&
      params.has("user") &&
      params.has("nonce")) {
    const chainid = parseInt(params.get("chainid")!);
    let user = utils.normalizeAddress(params.get("user")!);
    const nonce = parseInt(params.get("nonce")!);
    
    const gasPassChainid = process.env.GAS_PASS_CHAINID;
    if (gasPassChainid === undefined) {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.write(JSON.stringify({
        code: 0,
        msg: {
          is_verified: false,
          debug_msg: "not GAS_PASS_CHAINID",
        }
      }));
      res.end();
      return;
    }

    if (chainid == parseInt(gasPassChainid)) {
      try {
        const content = config.gasPassAbiContent;
        const provider = config.chainConfig.getProviderByChainId(chainid);
        const nftWallet = new ethers.Contract(user, content, provider);
        user = await nftWallet.owner();
      } catch (e) {
        user = utils.normalizeAddress(params.get("user")!);
      }
    }

    const item = await config.bdb3.t_src_transaction.findFirst({
      select: {
        is_verified: true,
        dst_chainid: true,
        dst_tx_hash: true,
        cctp_dstHash: true,
      },
      where: {
        chainid: chainid,
        sender: user,
        src_nonce: nonce,
      },
    });

    if (item === null) {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.write(JSON.stringify({
        code: 0,
        msg: {
          is_verified: false,
          debug_msg: "not synced in src network",
        }
      }));
      res.end();
      return;
    } else if (item.is_verified == 0) {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.write(JSON.stringify({
        code: 0,
        msg: {
          is_verified: false,
          debug_msg: "not synced in dst network",
        }
      }));
      res.end();
      return;
    } else if (item.is_verified == 1) {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.write(JSON.stringify({
        code: 0,
        msg: {
          is_verified: true,
          dst_chainid: item.dst_chainid,
          dst_tx_hash: item.dst_tx_hash === null ? item.cctp_dstHash : item.dst_tx_hash,
        }
      }));
      res.end();
      return;
    } else {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.write(JSON.stringify({code: -8, msg: "verified code is wrong"}));
      res.end();
      return;
    }
  } else if (params.has("chainid") &&
             params.has("tx_hash")) {

    const chainid = parseInt(params.get("chainid")!);
    const tx_hash = params.get("tx_hash")!.toLowerCase();

    const item = await config.bdb3.t_src_transaction.findFirst({
      select: {
        is_verified: true,
	      dst_chainid: true,
	      dst_tx_hash: true,
        cctp_dstHash: true,
      },
      where: {
        chainid: chainid,
        tx_hash: tx_hash,
      },
    })

    if (item === null) {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.write(JSON.stringify({
        code: 0,
        msg: {
          is_verified: false,
	        debug_msg: "not synced in src network",
	      }
	    }));
      res.end();
    } else if (item.is_verified == 0) {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.write(JSON.stringify({
        code: 0,
        msg: {
          is_verified: false,
	        debug_msg: "not synced in dst network",
        }
      }));
      res.end();
    } else if (item.is_verified == 1) {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.write(JSON.stringify({
        code: 0,
        msg: {
          is_verified: true,
          dst_chainid: item.dst_chainid,
          dst_tx_hash: item.dst_tx_hash === null ? item.cctp_dstHash : item.dst_tx_hash,
        }
      }));
      res.end();
    } else {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.write(JSON.stringify({code: -8, msg: "verified code is wrong"}));
      res.end();
    }
  } else if (params.has("tx_hash")) {
    const tx_hash = params.get("tx_hash")!.toLowerCase();

    const item = await config.bdb3.t_src_transaction.findFirst({
      select: {
        is_verified: true,
	      dst_chainid: true,
	      dst_tx_hash: true,
        cctp_dstHash: true,
      },
      where: {
        tx_hash: tx_hash,
      },
    });

    if (item === null) {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.write(JSON.stringify({
        code: 0,
        msg: {
          is_verified: false,
	        debug_msg: "not synced in src network",
	      }
	    }));
      res.end();
    } else if (item.is_verified == 0) {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.write(JSON.stringify({
        code: 0,
        msg: {
          is_verified: false,
	        debug_msg: "not synced in dst network",
        }
      }));
      res.end();
    } else if (item.is_verified == 1) {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.write(JSON.stringify({
        code: 0,
        msg: {
          is_verified: true,
          dst_chainid: item.dst_chainid,
          dst_tx_hash: item.dst_tx_hash === null ? item.cctp_dstHash : item.dst_tx_hash,
        }
      }));
      res.end();
    } else {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.write(JSON.stringify({code: -8, msg: "verified code is wrong"}));
      res.end();
    }
  } else {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.write(JSON.stringify({code: -6, msg: "query params error"}));
    res.end();
  }
}

