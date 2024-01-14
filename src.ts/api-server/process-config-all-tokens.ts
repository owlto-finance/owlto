import { Config } from "./config.js";
import { URL } from "url";
import http from "http";
import * as utils from "../utils/index.js";

export async function processConfigAllTokens(
    config: Config,
    requestUrl: URL,
    res: http.ServerResponse) {

  const tokens = config.tokenConfig.getAllTokens();
  res.writeHead(200, {'Content-Type': 'application/json'});
  res.write(JSON.stringify({code: 0, msg: tokens}, null, 4));
  res.end();
  return;
}

