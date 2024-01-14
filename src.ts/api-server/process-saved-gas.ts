import { Config } from "./config.js";
import { URL } from "url";
import { ethers } from "ethers";
import http from "http";
import * as utils from "../utils/index.js";
import axios from "axios";
import { Backend, loadBackend } from "../backends/index.js";

async function getGasPrice(backend: Backend) {
  const feeData = await backend.getGasPrice();
  if (feeData.gasPrice === null) {
    throw new Error("get FeeData error");
  }

  //utils.log("maxPriorityFee:", feeData.maxPriorityFeePerGas.toString());
  //utils.log("gasPrice:", feeData.gasPrice.toString());
  const gasPrice = feeData.gasPrice;
  return gasPrice;
}


async function getEthPrice(): Promise<number> {
  const url = "https://pro-api.coingecko.com/api/v3/simple/price?ids=weth&vs_currencies=usd&x_cg_pro_api_key=CG-2j4NfTm82pz3oz24VBR8SDwx";
  const rsp = await axios.get(url, { headers : { Accpept: "application/json" }});
  if (rsp.status != 200) {
    throw new Error("get eth price failed");
  }
  const data = rsp.data;
  if ("weth" in data && "usd" in data.weth) {
    return data.weth.usd;
  } else {
    throw new Error("get eth price format error");
  }
}

async function getBNBPrice(): Promise<number> {
  const url = "https://pro-api.coingecko.com/api/v3/simple/price?ids=wbnb&vs_currencies=usd&x_cg_pro_api_key=CG-2j4NfTm82pz3oz24VBR8SDwx";
  const rsp = await axios.get(url, { headers : { Accpept: "application/json" }});
  if (rsp.status != 200) {
    throw new Error("get bnb price failed");
  }
  const data = rsp.data;
  if ("wbnb" in data && "usd" in data.wbnb) {
    return data.wbnb.usd;
  } else {
    throw new Error("get bnb price format error");
  }
}

async function getMATICPrice(): Promise<number> {
  const url = "https://pro-api.coingecko.com/api/v3/simple/price?ids=wmatic&vs_currencies=usd&x_cg_pro_api_key=CG-2j4NfTm82pz3oz24VBR8SDwx";
  const rsp = await axios.get(url, { headers : { Accpept: "application/json" }});
  if (rsp.status != 200) {
    throw new Error("get matic price failed");
  }
  const data = rsp.data;
  if ("wmatic" in data && "usd" in data.wmatic) {
    return data.wmatic.usd;
  } else {
    throw new Error("get matic price format error");
  }
}

export async function processSavedTime(config: Config, requestUrl: URL, res: http.ServerResponse) {
  const params = requestUrl.searchParams;
  if (params.has("to_chainid") &&
      params.has("from_chainid")) {
    const fromChainId = parseInt(params.get("from_chainid")!);
    const toChainId = parseInt(params.get("to_chainid")!);

    const [spentTime, savedTime] = getTime(config, fromChainId, toChainId);

    res.writeHead(200, {'Content-Type': 'application/json'});
    res.write(JSON.stringify({
      code: 0, msg: {
        spent_minutes: parseInt(spentTime),
        saved_minutes: savedTime,
        cctp: 1080,
      }
    }, null, 4));
    res.end();
    return;
  }
}

export async function processSavedGasV3(config: Config, requestUrl: URL, res: http.ServerResponse) {
  const params = requestUrl.searchParams;
  if (params.has("token") &&
      params.has("from_chainid") &&
      params.has("to_chainid") &&
      params.has("maker") &&
      params.has("amount")) {

    const token = params.get("token")!.toUpperCase();
    const fromChainId = parseInt(params.get("from_chainid")!);
    const toChainId = parseInt(params.get("to_chainid")!);
    const makerAddress = utils.normalizeAddress(params.get("maker")!);
    const amountStr = params.get("amount")!;
    const amount = parseFloat(amountStr);

    const fromChainInfo = config.chainConfig.getChainInfoByChainId(fromChainId);
    const toChainInfo = config.chainConfig.getChainInfoByChainId(toChainId);

    const lp = config.lpInfos.getLpInfo(token, fromChainInfo.name, toChainInfo.name, makerAddress);
    if (lp === undefined) {
      throw new Error("savedGas, lp not found");
    }

    //const txFeeRatio = lp.txFeeRatio;
    const txFeeRatio = 0n;

    const baseChainInfo = config.chainConfig.getLayer1ChainInfoOrSelf(fromChainInfo.name);
    const baseChainId = baseChainInfo.chainId;

    const baseTokenInfo = config.tokenConfig.getInfoBySymbolAndChainId(token, baseChainId);
    const baseTokenAddress = baseTokenInfo.address;
    const baseTokenName = baseTokenInfo.symbol;

    const toBaseChainInfo = config.chainConfig.getLayer1ChainInfoOrSelf(toChainInfo.name);
    const toBaseChainId = toBaseChainInfo.chainId;
    const isBetweenLayer = toBaseChainId !== baseChainId;

    let nativePrice;
    let toNativePrice;
    if (baseChainId === 56) {
      nativePrice = await getBNBPrice();
    } else if (baseChainId === 137) {
      nativePrice = await getMATICPrice();
    } else if (baseChainId === 1501) {
      nativePrice = await utils.fetchBTCPrice();
    } else {
      nativePrice = await getEthPrice();
    }

    if (toBaseChainId === 56) {
      toNativePrice = await getBNBPrice();
    } else if (toBaseChainId === 137) {
      toNativePrice = await getMATICPrice();
    } else if (toBaseChainId === 1501) {
      toNativePrice = await utils.fetchBTCPrice();
    } else {
      toNativePrice = await getEthPrice();
    }

    const nativePriceInt = BigInt(Math.round(nativePrice));
    const toNativePriceInt = BigInt(Math.round(toNativePrice));

    const amountValue = ethers.parseUnits(amountStr, baseTokenInfo.decimal);

    let dtc = lp.dtc;
    let gasCompensation: bigint | undefined = undefined;

    const item = await config.online_db.t_dynamic_dtc.findUnique({    
      where: {
        token_name_from_chain_to_chain: {
          token_name: token,
          from_chain: fromChainInfo.name,
          to_chain: toChainInfo.name,
        },
      }
    });
    if (item === null) {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.write(JSON.stringify({code: 0, msg: "not dynamic dtc"}, null, 4));
      res.end();
      return;
    }
    let level = 3;
    if (amount < parseFloat(item.amount_lv1)) {
      level = 0;
    } else if (amount < parseFloat(item.amount_lv2)) {
      level = 1;
    } else if (amount < parseFloat(item.amount_lv3)) {
      level = 2;
    }
    switch (level) {
      case 0:
        gasCompensation = ethers.parseUnits(item.dtc_lv1, baseTokenInfo.decimal);
        break;
      case 1:
        gasCompensation = ethers.parseUnits(item.dtc_lv2, baseTokenInfo.decimal);
        break;
      case 2:
        gasCompensation = ethers.parseUnits(item.dtc_lv3, baseTokenInfo.decimal);
        break;
      case 3:
        gasCompensation = ethers.parseUnits(item.dtc_lv4, baseTokenInfo.decimal);
        break;
    }
    const iscctp = await utils.isCCTP(config.db, token, fromChainId, toChainId, amountStr);
    if (iscctp === true) {
      const dtc = await utils.getCCTP_DTC(config.db, fromChainId, toChainId);
      gasCompensation = ethers.parseUnits(dtc, baseTokenInfo.decimal);
    }
    if (gasCompensation === undefined) {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.write(JSON.stringify({code: 0, msg: "dynamic dtc err"}, null, 4));
      res.end();
      return;
    }

    if (baseTokenName === "USDT" || baseTokenName === "USDC" || baseTokenName === "DAI") {
      gasCompensation = gasCompensation / nativePriceInt;
    }

    let [originalFee, debugOriginalFee] = await computeOriginalFee(config, gasCompensation, baseChainInfo, fromChainInfo, toChainInfo, fromChainInfo.chainId, false, isBetweenLayer, toNativePriceInt, nativePriceInt);

    let bridgeFee = utils.computeTxFee(amountValue, txFeeRatio);
    let originalBridgeFee: bigint;
    if (bridgeFee === 0n) {
      originalBridgeFee = utils.computeTxFee(amountValue, 1n * 10000n * 100n);
    } else {
      originalBridgeFee = bridgeFee;
    }

    if (baseTokenName === "USDT" ||
        baseTokenName === "USDC" ||
        baseTokenName === "DAI") {
      bridgeFee = bridgeFee / nativePriceInt;
      originalBridgeFee = originalBridgeFee / nativePriceInt;
    }

    const total = bridgeFee + gasCompensation;
    if (originalFee < total * 2n) {
      originalFee = total * 2n;
    }
    const savedFee = originalFee - total;

    const [spentTime, savedTime] = getTime(config, fromChainId, toChainId);

    res.writeHead(200, {'Content-Type': 'application/json'});
    res.write(JSON.stringify({
      code: 0, msg: {
        spent_minutes: parseInt(spentTime),
        saved_minutes: iscctp === true ? 1080 : savedTime,
        eth_price: nativePrice,
        info_by_eth: {
          debugOriginalFee: ethers.formatEther(debugOriginalFee),
          originalFee: ethers.formatEther(originalFee),
          savedFee: ethers.formatEther(savedFee),
          bridgeFee: ethers.formatEther(bridgeFee),
          originalBridgeFee: ethers.formatEther(originalBridgeFee),
          dstChainCost: ethers.formatEther(gasCompensation),
          total: ethers.formatEther(total),
        },
        info_by_usd: {
          debugOriginalFee: parseFloat(ethers.formatEther(debugOriginalFee)) * nativePrice,
          originalFee: parseFloat(ethers.formatEther(originalFee)) * nativePrice,
          savedFee: parseFloat(ethers.formatEther(savedFee)) * nativePrice,
          bridgeFee: parseFloat(ethers.formatUnits(bridgeFee, baseTokenInfo.decimal)) * nativePrice,
          originalBridgeFee: parseFloat(ethers.formatEther(originalBridgeFee)) * nativePrice,
          dstChainCost: parseFloat(ethers.formatUnits(gasCompensation, baseTokenInfo.decimal)) * nativePrice,
          total: parseFloat(ethers.formatUnits(total, baseTokenInfo.decimal)) * nativePrice,
        },
      }
    }, null, 4));

    res.end();
    return;
  }
}

function getTime(
    config: Config,
    fromChainId: number,
    toChainId: number): [string, string] {
  let spentTime = "30";
  let savedTime = "10 min";
  const fromChain = config.chainConfig.getNameByChainId(fromChainId);
  const toChain = config.chainConfig.getNameByChainId(toChainId);
  if ( fromChain.startsWith("Starknet") || toChain.startsWith("Starknet")) {
    spentTime = "150";
  } else if (fromChainId === 1101 || toChainId === 1101) {
    spentTime = "40";
  }

  switch (fromChainId) {
    case 42161:
    case 42170:
    case 10:
    case 7777777:
    case 8453:
    case 169:
    case 255:
    case 204:
      savedTime = "7 days";
      break;
    case 324:
    case 59144:
    case 666666666:
      savedTime = "24 hours";
      break;
    case 1101:
      savedTime = "6 hours";
      break;
    case 534352:
      savedTime = "2 hours";
      break;
  }

  return [spentTime, savedTime];

}


async function computeOriginalFee(
    config: Config,
    gasCompensation: bigint,
    baseChain: utils.ChainInfo,
    chain1: utils.ChainInfo,
    chain2: utils.ChainInfo,
    fromChainId: number,
    bidirect: boolean,
    isBetweenLayer: boolean,
    toNativePrice: bigint, 
    nativePrice: bigint): Promise<[bigint, bigint]>{

  let fromChain: utils.ChainInfo;
  let toChain: utils.ChainInfo;
  if (bidirect) {
    if (fromChainId === chain1.chainId) {
      fromChain = chain1;
      toChain = chain2;
    } else if (fromChainId === chain2.chainId) {
      fromChain = chain2;
      toChain = chain1;
    } else {
      throw new Error("fromChainId is not in lp");
    }
  } else {
    fromChain = chain1;
    toChain = chain2;
  }

  const fromBackend = await loadBackend(config, fromChain.name);
  const toBackend = await loadBackend(config, toChain.name);
  const baseBackend = await loadBackend(config, baseChain.name);

  const fromGasPricePromise = getGasPrice(fromBackend);
  const toGasPricePromise = getGasPrice(toBackend);
  const baseGasPricePromise = getGasPrice(baseBackend);

  const [
    fromGasPrice,
    toGasPrice,
    baseGasPrice,
  ] = await Promise.all([
    fromGasPricePromise, toGasPricePromise, baseGasPricePromise
  ]);

  let originalFee = 0n;
  if (isBetweenLayer) {
    originalFee = BigInt(fromChain.transferErc20Gas!) * fromGasPrice + BigInt(toChain.transferErc20Gas!) * toGasPrice * toNativePrice / nativePrice;
  } else {
    if (utils.isLayer1(fromChain)) {
      originalFee = BigInt(toChain.depositGas!) * fromGasPrice;
    } else if (utils.isLayer1(toChain)) {
      originalFee = BigInt(fromChain.withdrawGas!) * fromGasPrice;
    } else {
      originalFee = BigInt(fromChain.withdrawGas!) * fromGasPrice + (
        BigInt(toChain.depositGas!) * baseGasPrice);
    }
  }

  const debugOriginalFee = originalFee;
  if (gasCompensation * 2n > originalFee) {
    originalFee = gasCompensation * 2n;
  }
  return [originalFee, debugOriginalFee];
}

