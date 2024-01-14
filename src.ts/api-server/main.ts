import { ethers } from "ethers";
import http from "http";
import { URL } from "url";
import * as utils from "../utils/index.js";
import { PrismaClient } from "@prisma/client";
import listen from "async-listen";
import { getConfig } from "./config.js";
import { processVerify } from "./process-verify.js";
import { processLpInfo } from "./process-lp-info.js";
import { processSavedGasV3 } from "./process-saved-gas.js";
import { processSavedTime } from "./process-saved-gas.js";
import { processChains } from "./process-chains.js";
import { processChainInfo } from "./process-chain-info.js";
import { processConfigTokensV2 } from "./process-config-tokens.js";
import { processConfigFromToChainsV2, processConfigFromToChainsV3 } from "./process-config-from-to-chains.js";
import { processConfigAllChains } from "./process-config-all-chains.js";
import { processConfigRealAllChains } from "./process-config-all-chains.js";
import { processConfigAllTokens } from "./process-config-all-tokens.js";
import { processTxSrc } from "./process-tx-src.js";
import { processGetTransaction } from "./process-get-transaction.js";
import { processDynamicDtc } from "./process-dynamic-dtc.js";

import { processGas } from "./process-gas.js";

async function main() {
  const config = await getConfig("config");

  const server = http.createServer(async function(req, res) {
    try {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Max-Age', '3600');
      if (req.method == "OPTIONS") {
        res.writeHead(200);
        res.end();
        return;
      }

      if (req.url == undefined || req.url == null) {
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.write(JSON.stringify({code: -5, msg: "url is empty"}));
        res.end();
        return;
      }

      const requestUrl = new URL(req.url!, `http://${req.headers.host}`);

      if (requestUrl.pathname == "/api/verify") {
        await processVerify(config, requestUrl, res);
      } else if (requestUrl.pathname == "/api/lp-info") {
        await processLpInfo(config, requestUrl, res);
      } else if (requestUrl.pathname == "/api/config/real-all-chains") {
        await processConfigRealAllChains(config, requestUrl, res);
      } else if (requestUrl.pathname == "/api/config/all-chains") {
        await processConfigAllChains(config, requestUrl, res);
      } else if (requestUrl.pathname == "/api/config/all-tokens") {
        await processConfigAllTokens(config, requestUrl, res);
      } else if (requestUrl.pathname == "/api/config/tokens") {
        await processConfigTokensV2(config, requestUrl, res);
      } else if (requestUrl.pathname == "/api/config/from-to-chains") {
        await processConfigFromToChainsV2(config, requestUrl, res);
      } else if (requestUrl.pathname == "/api/config/filter-from-to-chains") {
        await processConfigFromToChainsV3(config, requestUrl, res);
      } else if (requestUrl.pathname == "/api/saved_gas") {
        await processSavedGasV3(config, requestUrl, res);
      } else if (requestUrl.pathname == "/api/chains") {
        await processChains(config, requestUrl, res);
      } else if (requestUrl.pathname == "/api/chain_info") {
        await processChainInfo(config, requestUrl, res);
      } else if (requestUrl.pathname == "/api/gas") {
        await processGas(config, requestUrl, res);
      } else if (requestUrl.pathname == "/api/config/tokensV2") {
        await processConfigTokensV2(config, requestUrl, res);
      } else if (requestUrl.pathname == "/api/config/from-to-chainsV2") {
        await processConfigFromToChainsV2(config, requestUrl, res);
      } else if (requestUrl.pathname == "/api/src-tx") {
        await processTxSrc(config, requestUrl, res);
      } else if (requestUrl.pathname == "/api/get-transaction") {
        await processGetTransaction(config, requestUrl, res);
      } else if (requestUrl.pathname == "/api/saved-time") {
        await processSavedTime(config, requestUrl, res);
      } else if (requestUrl.pathname == "/api/dynamic-dtc") {
        await processDynamicDtc(config, requestUrl, res);
      } else {
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.write(JSON.stringify({code: -4, msg: "path error"}));
        res.end();
        return;
      }
    } catch (error) {
      utils.log(error);
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.write(JSON.stringify({code: -502, msg: "Internal Server Error"}));
      res.end();
      return;
    }
  });


  function shutdown() {
    utils.log("shutting down server...");
    server.close(() => {
      utils.log("server has been closed");
      process.exit(0);
    });
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const address = await listen(server, 5001);
  utils.log("tx_server start listening on localhost:5001");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

