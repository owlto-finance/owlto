import { ethers } from "ethers";
import { getChecksumAddress } from "starknet";
import { Backend } from "./types.js";

import {
  Config,
  EthersConfig,
  getEthersConfig
} from "./config.js"

import { EthersBackend } from "./ethers.js";
import { StarknetBackend, getStarknetConfig } from "./starknet.js";
import { EvmJsonBackend } from "./evm_json.js";

import * as utils from "../utils/index.js";

export {
	Backend, SendTransactionResult, NativeTransferRequest,
	ERC20TransferRequest, GasPriceRequest, GasPriceResult,
} from "./types.js";

export { EthersBackend } from "./ethers.js";
export { Config, getConfig, getBridgeConfig } from "./config.js"

const g_backendCache = new Map<string, Backend>();

function getTestKey(backendName: string) {
  let testPrivateKey: string | undefined = undefined;
  let testAddress: string | undefined = undefined;
  if (backendName == "starknet") {
    testPrivateKey = process.env.TEST_STARKNET_PRIVATE_KEY;
    testAddress = process.env.TEST_STARKNET_ADDRESS;
  } else {
    testPrivateKey = process.env.TEST_PRIVATE_KEY;
    if (testPrivateKey !== undefined) {
      testAddress = utils.privateKeyToAddress(testPrivateKey);
    }
  }
  if (testPrivateKey === undefined) {
    throw new Error("testPrivateKey is undefined");
  }
  if (testAddress === undefined) {
    throw new Error("testAddress is undefined");
  }
  return [testPrivateKey, testAddress];
}

export async function loadBackend(
    config: Config,
    networkName: string,
    isClient: boolean = false): Promise<Backend> {

  if (g_backendCache.size === 0) {
    for (const [name, chainInfo] of config.chainConfig.chainInfos.entries()) {
      if (chainInfo.fake || chainInfo.enable === false) {
        continue;
      }
    	let backend: Backend;
      if (chainInfo.backend === "starknet") {
		    const starknetConfig = await getStarknetConfig(config.dir, chainInfo.rpcUrl);
        if (isClient) {
          const [testPrivateKey, testAddress] = getTestKey(chainInfo.backend);
		      backend = new StarknetBackend(config, name, starknetConfig, testPrivateKey, testAddress);
        } else {
		      backend = new StarknetBackend(config, name, starknetConfig);
        }
      } else if (chainInfo.name.startsWith("Zkfair") || chainInfo.name.startsWith("OkxX1")) {
		    const ethersConfig = await getEthersConfig(config.dir);
        backend = new EvmJsonBackend(config, chainInfo, ethersConfig);
      } else {
		    const ethersConfig = await getEthersConfig(config.dir);
        if (isClient) {
          const [testPrivateKey, testAddress] = getTestKey(chainInfo.backend);
          backend = new EthersBackend(config, name, ethersConfig, testPrivateKey);
        } else {
		      backend = new EthersBackend(config, name, ethersConfig);
        }
	    }
	    await backend.setup()
      g_backendCache.set(name, backend);
    }
  }

  if (g_backendCache.has(networkName)) {
    return g_backendCache.get(networkName)!;
  } else {
    throw new Error(`no backend for network ${networkName}`);
  }
}
