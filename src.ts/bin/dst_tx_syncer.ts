import dotenv from "dotenv";
dotenv.config();

import * as utils from "../utils/index.js";
import { NewDstSyncRecord } from "./type.js";
import { ethers } from "ethers";
import { loadBackend, Backend, Config, getConfig } from "../backends/index.js";

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

async function writeRecordsToDBByHash(
    config: Config,
    network: utils.Network,
    records: Array<NewDstSyncRecord>,
    blockNumber: number): Promise<void> {

  await config.db.$transaction([
    ...records.map((item) => config.db.t_src_transaction.updateMany({
      where: {
        dst_chainid: item.dst_chainid,
        dst_tx_hash: item.dst_tx_hash,
        receiver: item.sender,
      },
      data: {
        is_verified: item.is_verified,
      },
    })),
    config.db.t_event_processed_block.upsert({
      where: {
        chainid_appid: {
          chainid: network.chainId,
          appid: config.appid,
        },
      },
      create: { appid: config.appid, chainid: network.chainId, block_number: blockNumber },
      update: { block_number: blockNumber }
    })
  ]);
}


async function writeRecordsToDBByNonce(
    config: Config,
    network: utils.Network,
    records: Array<NewDstSyncRecord>,
    blockNumber: number): Promise<void> {

  await config.db.$transaction([
    ...records.map((item) => config.db.t_src_transaction.updateMany({
      where: {
        dst_chainid: item.dst_chainid,
        dst_nonce: item.dst_nonce,
	receiver: item.sender,
      },
      data: {
        is_verified: item.is_verified,
        dst_tx_hash: item.dst_tx_hash,
      },
    })),
    config.db.t_event_processed_block.upsert({
      where: {
        chainid_appid: {
          chainid: network.chainId,
          appid: config.appid,
        },
      },
      create: { appid: config.appid, chainid: network.chainId, block_number: blockNumber },
      update: { block_number: blockNumber }
    })
  ]);
}

function printRecords(config: Config, records: Array<NewDstSyncRecord>) {
  for (const record of records) {
    utils.log(
      config.appid,
      record.dst_chainid,
      "[", record.sender, "->", record.receiver, "]",
      ethers.formatEther(record.value)
    );
  }
}

function constructBlockRange(from: number, to: number) {
  const result: Array<number> = [];
  for (let i = from; i <= to; i++) {
    result.push(i);
  }
  return result;
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
      const records = await backend.getDstNativeSyncRecords(fromBlockNumber, toBlockNumber, skip, skipBlocks);
      skipBlocks.sort((a, b) => a - b);
      skip = skipBlocks;
      if (skipBlocks.length > 0) {
        lastBlockNumber = skipBlocks[0] - 1 > lastBlockNumber ? skipBlocks[0] - 1 : lastBlockNumber;
      } else {
        lastBlockNumber = toBlockNumber;
      }
      if (name === "ScrollMainnet" || name === "ZkfairMainnet") {
        await writeRecordsToDBByHash(config, network, records, lastBlockNumber);
      } else {
        await writeRecordsToDBByNonce(config, network, records, lastBlockNumber);
      }
      hasScanBlockNumber = toBlockNumber;
      printRecords(config, records);
    } catch (error) {
      if (error instanceof TypeError) {
        if (error.message.startsWith("missing r")) {
        //utils.log("tail catch type error: missing r");
        } else {
          utils.log("tail catch type error:", error.message);
        }
      } else {
        utils.log("tail catch error:", error);
      }
      await utils.sleep(3);
    }
  }
}

async function main() {
  const configDir = "config";
  const config = await getConfig(configDir, 2);
  assertConfig(config);

  utils.log("start sync dst blocks ...");
  const promises: Array<Promise<void>> = [];
  for (const [name, network] of config.networkConfig) {
    const chain = config.chainConfig.getChainInfoByName(name);
    if (chain.fake === true || chain.enable === false) {
      continue;
    }
    promises.push(processSyncBlocks(config, name, network));
  }
  await Promise.all(promises);
 
}

main()
  .then(()=>process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
