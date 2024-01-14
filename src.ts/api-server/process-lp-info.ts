import { Config } from "./config.js";
import { URL } from "url";
import http from "http";
import * as utils from "../utils/index.js";
import { PrismaClient } from "@prisma/client";
import { ethers } from "ethers";
import { Backend, loadBackend } from "../backends/index.js";

async function getBalance(
    backend: Backend,
    tokenAddress: string,
    user: string) {
  if (tokenAddress === ethers.ZeroAddress) {
    return backend.getNativeBalance(user);
  } else {
    return backend.getERC20Balance(user, tokenAddress);
  }
}

export async function processLpInfo(
    config: Config,
    requestUrl: URL,
    res: http.ServerResponse) {
  const params = requestUrl.searchParams;
  if (params.has("token") &&
      params.has("from_chainid") &&
      params.has("to_chainid") &&
      params.has("user")) {

    const from_chainid = Number(params.get("from_chainid")!);
    const to_chainid = Number(params.get("to_chainid")!);
    const tokenName = params.get("token")!.toUpperCase();


    const fromChainInfo = config.chainConfig.getChainInfoByChainId(from_chainid);
    const toChainInfo = config.chainConfig.getChainInfoByChainId(to_chainid);

    let makerAddress = config.makerAddress;
    if (fromChainInfo.name.startsWith("Starknet")) {
      makerAddress = config.starknetMakerAddress;
    }
    const user = utils.normalizeAddress(params.get("user")!);

    let toUser = user;
    if (params.has("to_user_address")) {
      toUser = utils.normalizeAddress(params.get("to_user_address")!);
    }

    const fromChainName = fromChainInfo.name;
    const toChainName = toChainInfo.name;

    const fromBackend = await loadBackend(config, fromChainName);
    const toBackend = await loadBackend(config, toChainName);

    const fromTokenInfo = config.tokenConfig.getInfoBySymbolAndChainId(tokenName, from_chainid);
    const toTokenInfo = config.tokenConfig.getInfoBySymbolAndChainId(tokenName, to_chainid);

    const lp = config.lpInfos.getLpInfo(tokenName, fromChainName, toChainName, makerAddress);
    if (lp === undefined) {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.write(JSON.stringify({code: -5, msg: "lp info not found"}));
      res.end();
      return;
    }

    const fromBalancePromise = getBalance(fromBackend, fromTokenInfo.address, user);
    const toBalancePromise = getBalance(toBackend, toTokenInfo.address, toUser);
    const price = config.bdb3.t_update_price.findUnique({
      where: {
        token: tokenName,
        update_timestamp: {
          gt: new Date(Date.now()- 3600000),
        },
      },
    });
    const [fromBalance, toBalance, tokenPrice] = await Promise.all([fromBalancePromise, toBalancePromise, price]);

    let contract_address = "";
    if (fromChainName.startsWith("Starknet") || toChainName.startsWith("Starknet")) {
      if (fromChainInfo.transferContractAddress !== undefined) {
        contract_address = fromChainInfo.transferContractAddress;
      } else {
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.write(JSON.stringify({code: -5, msg: "bridge_contract_address not found"}));
        res.end();
        return;
      }
    }
    let is_cctp = 0;
    let cctp_amount = "0";
    let cctp_dtc = "0";
    if (tokenName === "USDC") {
      const min_value = await config.bdb3.t_cctp_support_chain.findUnique({
        select: {
          min_value: true,
        },
        where: {
          chainid: to_chainid,
        },
      });
      const src_cctp = await config.bdb3.t_cctp_support_chain.findUnique({
        where: {
          chainid: from_chainid,
        },
      });
      if (src_cctp !== null && min_value !== null) {
        cctp_amount = ethers.parseUnits(min_value.min_value, fromTokenInfo.decimal).toString();
        is_cctp = 1;
        const ccptDTC = await utils.getCCTP_DTC(config.bdb3, from_chainid, to_chainid);
        cctp_dtc = ethers.parseUnits(ccptDTC, fromTokenInfo.decimal).toString();
      }
    }
    const result = {
      from_balance: fromBalance.toString(),
      to_balance: toBalance.toString(),
      token_name: tokenName,
      token_decimal: fromTokenInfo.decimal,
      dst_token_decimal: toTokenInfo.decimal,
      min: ethers.parseUnits(lp.min_value, fromTokenInfo.decimal).toString(),
      max: ethers.parseUnits(lp.max_value, fromTokenInfo.decimal).toString(),
      dtc: ethers.parseUnits(lp.dtc, fromTokenInfo.decimal).toString(),
      bridge_fee_ratio: lp.bridge_fee_ratio,

      from_chainid: fromChainInfo.chainId,
      from_token_address: fromTokenInfo.address,

      to_chainid: toChainInfo.chainId,
      to_token_address: toTokenInfo.address,
      maker_address: makerAddress,
      bridge_contract_address: contract_address,

      gas_token_name: toChainInfo.gasToken,
      gas_token_decimal: toChainInfo.gasTokenDecimal,
      estimated_gas: "100000000000",

      token_price: tokenPrice?.price ?? "0",
      cctp_amount: cctp_amount,
      is_cctp: is_cctp,
      cctp_dtc: cctp_dtc,
    };

    res.writeHead(200, {'Content-Type': 'application/json'});
    res.write(JSON.stringify({
      code: 0,
      msg: result
    }, null, 4));
    res.end();

    return;
  } else {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.write(JSON.stringify({code: -5, msg: "params error"}));
    res.end();
    return;
  }
}

