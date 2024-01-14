import { Config } from "./config.js";
import { URL } from "url";
import http from "http";
import * as utils from "../utils/index.js";
import { ethers } from "ethers";
import { loadBackend } from "../backends/index.js";

export async function processDynamicDtc(
    config: Config,
    requestUrl: URL,
    res: http.ServerResponse) {

  const params = requestUrl.searchParams;
  if (params.has("from") &&
      params.has("to") &&
      params.has("token") &&
      params.has("amount")) {

    const fromParam = params.get("from")!;
    let from: string;
    if (utils.isAllDigitString(fromParam) === false) {
      from = fromParam;
    } else {
      from = config.chainConfig.getNameByChainId(Number(fromParam));
    }
    const toParam = params.get("to")!;
    let to: string;
    if (utils.isAllDigitString(toParam) === false) {
      to = toParam;
    } else {
      to = config.chainConfig.getNameByChainId(Number(toParam));
    }
    const token = params.get("token")!.toUpperCase();
    const amount = params.get("amount")!;

    const item = await config.online_db.t_dynamic_dtc.findUnique({    
      where: {
        token_name_from_chain_to_chain: {
          token_name: token,
          from_chain: from,
          to_chain: to,
        },
      }
    });

    if (item === null) {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.write(JSON.stringify({code: -5, msg: "lp info not found"}));
      res.end();
      return;
    }

    let level = 3;
    if (Number(amount) < Number(item.amount_lv1)) {
      level = 0;
    } else if (Number(amount) < Number(item.amount_lv2)) {
      level = 1;
    } else if (Number(amount) < Number(item.amount_lv3)) {
      level = 2;
    }

    let dtc: string;
    switch (level) {
      case 0:
        dtc = item.dtc_lv1;
        break;
      case 1:
        dtc = item.dtc_lv2;
        break;
      case 2:
        dtc = item.dtc_lv3;
        break;
      case 3:
        dtc = item.dtc_lv4;
        break;
      default:
        dtc = item.dtc_lv4;
        break;
    }

    res.writeHead(200, {'Content-Type': 'application/json'});
    res.write(JSON.stringify({code: 0, msg: dtc}));
    res.end();
    return;
  } else {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.write(JSON.stringify({code: -6, msg: "query params error"}));
    res.end();
    return;
  }
}

