import dotenv from "dotenv";
dotenv.config();

import { NewSrcSyncRecord } from "./type.js";
import * as utils from "../utils/index.js";
import { Backend, loadBackend, Config, getConfig } from "../backends/index.js";
import { ethers } from "ethers";

async function getLastBlockNumber(
	  config: Config,
	  chain: utils.ChainInfo,
    backend: Backend,
    hasScan: number): Promise<[number, number, number, boolean]> {

  const item = await config.db.t_event_processed_block.findFirst({
    select: {
      block_number: true,
    },
    where: {
      chainid: chain.chainId,
      appid: config.appid,
    },
  });
    
  let lastBlockNumber = 0;
  let isEmpty = false;

  if (item === null) {
    isEmpty = true;
  } else {
    lastBlockNumber = Number(item.block_number);
  }

  const latestBlockNumber = await backend.getBlockNumber();
  let hasScanBlock = hasScan;
  if (hasScan === 0) {
    if (lastBlockNumber !== 0) {
      hasScanBlock = lastBlockNumber;
    } else {
      if (latestBlockNumber > 10) {
        hasScanBlock = latestBlockNumber - 10;
      } else {
        hasScanBlock = latestBlockNumber;
      }
    }
  }
  return [lastBlockNumber, hasScanBlock, latestBlockNumber, isEmpty];
}

async function writeRecordsToDB(
    config: Config,
    network: utils.Network,
    records: Array<NewSrcSyncRecord>,
    blockNumber: number): Promise<void> {

  await config.db.$transaction([
    ...records.map((item) => config.db.t_src_transaction.upsert({
      where: {
        chainid_tx_hash: {
          chainid: item.chainid,
          tx_hash: item.tx_hash,
        },
      },
      create: item,
      update: {},
    })),
    config.db.t_event_processed_block.upsert({
      where: {
        chainid_appid: {
          chainid: network.chainId,
	        appid: config.appid
        }
      },
      create: { appid: config.appid, chainid: network.chainId, block_number: blockNumber },
      update: { block_number: blockNumber }
    })
  ]);
}

async function getGappedBlockNumber(
    config: Config,
    chain: utils.ChainInfo): Promise<Array<number>> {

  const result: Array<number> = [];

  const items = await config.db.t_gapped_block.findMany({
    select: {
      block_number: true,
    },
    where: {
      chainid: chain.chainId,
      appid: config.appid,
      is_processed: 0,
    },
    take: 3,
  });

  for (const item of items) {
    result.push(item.block_number);
  }

  return result;
}

async function markGappedBlockNumbers(
    config: Config,
    chain: utils.ChainInfo,
    blockNumbers: Array<number>) {

  return config.db.t_gapped_block.updateMany({
    where: {
      chainid: chain.chainId,
      appid: config.appid,
      block_number: {
        in: blockNumbers,
      },
    },
    data: {
      is_processed: 1,
    },
  });
}

function printRecords(config: Config, records: Array<NewSrcSyncRecord>) {
  for (const record of records) {
    utils.log(
      config.appid,
      record.chainid,
      "[", record.sender, "->", record.receiver, "]",
      record.dst_chainid,
      ethers.formatEther(record.value)
    );
  }
}

function assertConfig(config: Config) {
  if (config.appid === undefined) {
    throw new Error("appid not found in config file");
  }
}

async function processSyncBlocks(
    config: Config,
    name: string,
    network: utils.Network): Promise<void> {

  const chain = config.chainConfig.getChainInfoByName(name);
  let interval = chain.blockInterval;
  if (interval < 1000) {
    interval = 1000;
  }
  if (chain.name === "ZkfairMainnet") {
    interval = 500;
  }
  const baseSleepTime = interval;
  let skip = new Array<number>();
  let hasScanBlockNumber = 0;

  let lastProcessedTimeMs = 0;
  for (;;) {
    try {
      const sleepTime = baseSleepTime - (Date.now() - lastProcessedTimeMs);
      if (sleepTime > 0) {
        await utils.msleep(sleepTime);
      }
      lastProcessedTimeMs = Date.now();

      if (chain.fake || !chain.enable) {
        continue;
      }
      const backend = await loadBackend(config, name);

      const network = config.networkConfig.get(name)!;
      if (!network.tx_enable) {
        continue;
      }

      // get gapped block
      const gappedBlockNumbers = await getGappedBlockNumber(config, chain);

      let [
        lastBlockNumber,
        hasScanBlock,
        latestBlockNumber,
        noLastBlock
      ] = await getLastBlockNumber(config, chain, backend, hasScanBlockNumber);
  
      let fromBlockNumber = 0;
      let toBlockNumber = 0;
      if (skip.length > 3) {
        fromBlockNumber = hasScanBlock;
        toBlockNumber = hasScanBlock;
      } else {
        fromBlockNumber = hasScanBlock + 1;
        if (fromBlockNumber > latestBlockNumber) {
          continue;
        }

        toBlockNumber = fromBlockNumber + network.blockFetchBatchNum;
        if (toBlockNumber > latestBlockNumber) {
          toBlockNumber = latestBlockNumber;
        }

      }
    
      const skipBlocks = new Array<number>();
      const allExtraBlockNumbers = gappedBlockNumbers.concat(skip);
      const records = await backend.getSrcNativeSyncRecords(fromBlockNumber, toBlockNumber, allExtraBlockNumbers, skipBlocks);

      skipBlocks.sort((a, b) => a - b);
      skip = skipBlocks; 
      if (skipBlocks.length == 0) {
        lastBlockNumber = toBlockNumber;
      } else {
        lastBlockNumber = skipBlocks[0] - 1 > lastBlockNumber ? skipBlocks[0] - 1 : lastBlockNumber;
      }
      await writeRecordsToDB(config, network, records, lastBlockNumber);
      hasScanBlockNumber = toBlockNumber;

      if (gappedBlockNumbers.length > 0) {
        await markGappedBlockNumbers(config, chain, gappedBlockNumbers);
      }

      printRecords(config, records);
    } catch (error) {
      if (error instanceof TypeError) {
        if (error.message.startsWith("missing r")) {
          //utils.log("tail catch type error: missing r");
        } else {
          utils.log(name, "tail catch type error:", error.message);
        }
      } else {
        utils.log(name, "tail catch error:", error);
      }
      await utils.sleep(3);
    }
  }
}

async function main() {
  const configFile = "config";
  const config = await getConfig(configFile, 1);
  assertConfig(config);

  utils.log("start sync src blocks ...");
  const promises: Array<Promise<void>> = [];
  for (const [name, network] of config.networkConfig) {
    const chain = config.chainConfig.getChainInfoByName(name);
    if (chain.fake === true || chain.enable === false) {
      continue;
    }
    const promise = processSyncBlocks(config, name, network);
    promises.push(promise);
  }

  await Promise.all(promises);
}

main()
  .then(()=>process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
