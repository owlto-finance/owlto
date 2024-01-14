import { Config } from "./config.js";
import { URL } from "url";
import http from "http";
import * as utils from "../utils/index.js";
import { ethers } from "ethers";
import { loadBackend, Backend } from "../backends/index.js";

interface Item {
  chain: string,
  gas: string,
  gasPrice: string,
  gasFee: string,
}

async function getGas(config: Config, chain: utils.ChainInfo, backend: Backend) {
  const to = "0x3375255E3e531452be479c4Cd68B738193F7fB00";
  const value = 100000n;
  return backend.estimateNativeTransferGas(to, value);
}

async function getGasPrice(config: Config, chain: utils.ChainInfo, backend: Backend): Promise<bigint> {
  const feeData = await backend.getGasPrice();
  if (feeData.maxFeePerGas === null) {
    return feeData.gasPrice!;
  } else {
    const baseFee = await backend.getBaseFee("latest");
    if (baseFee === null) {
      throw new Error("get baseFee failed, network=" + chain.name);
    }
    return baseFee;
  }
}

// /api/gas
export async function processGas(
    config: Config,
    requestUrl: URL,
    res: http.ServerResponse) {

  let env = config.env;

  const items: Array<Item> = [];
  const chains = config.chainConfig.getAllChainInfos();

  for (const chain of chains) {
    const backend = await loadBackend(config, chain.name);
    const gas = await getGas(config, chain, backend);
    const gasPrice = await getGasPrice(config, chain, backend);
    const gasFee = gas * gasPrice;
    
    const item = {
      chain: chain.aliasName,
      gas: gas.toString(),
      gasPrice: ethers.formatUnits(gasPrice, "gwei"),
      gasFee: ethers.formatEther(gasFee),
    }
    items.push(item);
  }

  res.writeHead(200, {'Content-Type': 'application/json'});
  res.write(JSON.stringify({"gas": items}, null, 4));

  res.end();
  return;
}
