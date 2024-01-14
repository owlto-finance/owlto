import dotenv from "dotenv";
dotenv.config();

import * as utils from "../utils/index.js";
import { NewDstSyncRecord } from "./type.js";
import { ethers } from "ethers";
import { loadBackend, Backend, Config, getConfig } from "../backends/index.js";

async function getLastBlockNumber(
    config: Config,
    chain: utils.ChainInfo,
    backend: Backend): Promise<[number, number, boolean]> {

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
  if (lastBlockNumber === 0) {
    if (latestBlockNumber > 10) {
      lastBlockNumber = latestBlockNumber - 10;
    } else {
      lastBlockNumber = latestBlockNumber;
    }
  }
  return [lastBlockNumber, latestBlockNumber, isEmpty];
}

async function getGappedBlockNumber(
  config: Config,
  chain: utils.ChainInfo): Promise<number | null> {

const item = await config.db.t_gapped_block.findFirst({
  select: {
    block_number: true,
  },
  where: {
    chainid: chain.chainId,
    appid: config.appid,
    is_processed: 0,
  },
});

if (item === null) {
  return null;
} else {
  return item.block_number;
}
}

async function markGappedBlockNumber(
  config: Config,
  chain: utils.ChainInfo,
  blockNumber: number | null) {

if (blockNumber === null) {
  return;
}

return config.db.t_gapped_block.updateMany({
  where: {
    chainid: chain.chainId,
    appid: config.appid,
    block_number: blockNumber,
  },
  data: {
    is_processed: 1,
  },
});
}

async function writeRecordsToDB(
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
      data: { is_verified: item.is_verified },
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

function assertConfig(config: Config) {
  if (config.appid === undefined) {
    throw new Error("appid not found in config file");
  }
}

async function processSyncBlock(
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
      if (!network.log_enable) {
        continue;
      }

      const gappedChains: string[] = ["MantleMainnet"];

      let fromBlockNumber = 0;
      let toBlockNumber = 0;
      const isGappedChain = gappedChains.includes(chain.name);
      if (isGappedChain === true) {
        const gappedBlockNumber = await getGappedBlockNumber(config, chain);
        if (gappedBlockNumber !== null) {
          fromBlockNumber = gappedBlockNumber;
          toBlockNumber = gappedBlockNumber;
        }
      } else{
        const [
          lastBlockNumber,
          realLatestBlockNumber,
          noLastBlock
        ] = await getLastBlockNumber(config, chain, backend);
    
        let latestBlockNumber = realLatestBlockNumber - 1;
        if (name.startsWith("Starknet")) {
          latestBlockNumber = latestBlockNumber - 2;
        } else if (name.startsWith("Zkfair")) {
          latestBlockNumber = latestBlockNumber - 5;
        }

        fromBlockNumber = lastBlockNumber + 1;
        if (fromBlockNumber > latestBlockNumber) {
          continue;
        }

        toBlockNumber = fromBlockNumber + network.logFetchBatchNum;
        if (toBlockNumber > latestBlockNumber) {
          toBlockNumber = latestBlockNumber;
        }
      }

      if (fromBlockNumber > 0) {
        const records = await backend.getDstERC20SyncRecords(fromBlockNumber, toBlockNumber);
        await writeRecordsToDB(config, network, records, toBlockNumber);
        if (isGappedChain === true) {
          await markGappedBlockNumber(config, chain, fromBlockNumber);
        }
        printRecords(config, records);
      }
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
  const configDir = "config";
  const config = await getConfig(configDir, 4);
  assertConfig(config);

  utils.log("start sync dst events ...");
  const promises: Array<Promise<void>> = [];
  for (const [name, network] of config.networkConfig) {
    const chain = config.chainConfig.getChainInfoByName(name);
    if (chain.fake === true || chain.enable === false) {
      continue;
    }
    promises.push(processSyncBlock(config, name, network));
  }
  await Promise.all(promises);
}

main()
  .then(()=>process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
