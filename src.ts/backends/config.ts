import * as utils from "../utils/index.js";
import { ethers } from "ethers";
import { PrismaClient } from "@prisma/client";

export interface Config {
	dir: string,
	env: string,
	appid: number,
  abi: ethers.AbiCoder,
	makerWatchCounterId: number,
	makerConfig: utils.MakerConfig,
	starknetMakerConfig: utils.MakerConfig,
	makerAddress: string,
  starknetMakerAddress: string,
	chainConfig: utils.ChainConfig,
  dstChainConfig: utils.DstChainConfig,
	tokenConfig: utils.TokenConfig,
	networkConfig: Map<string, utils.Network>,
	txNetworkConfig: Map<string, utils.Network>,
  claimConfig: utils.ClaimConfig,
  claimConfigV2: utils.ClaimConfig,
	db: PrismaClient,
  bdb: PrismaClient,
  bdb2: PrismaClient,
  bdb3: PrismaClient,
  online_db: PrismaClient,
  online_bdb: PrismaClient,

	counterId: number,
	sleepTime: number,
	tokens: string[],
	gapValue: bigint;
}

export async function getConfig(
    configDir: string,
    appid: number,
    env: string | undefined = undefined): Promise<Config> {

	env = env || process.env.ENV;
	if (env === undefined) {
		throw new Error("no env field .env");
	}

  const backupDBUrl = process.env.BACKUP_DATABASE_URL;
  if (backupDBUrl === undefined) {
		throw new Error("no backupDBUrl field .env");
  }

  const backupDB2Url = process.env.BACKUP2_DATABASE_URL;
  if (backupDB2Url === undefined) {
		throw new Error("no backupDBUrl field .env");
  }

  const backupDB3Url = process.env.BACKUP3_DATABASE_URL;
  if (backupDB3Url === undefined) {
		throw new Error("no backupDBUrl field .env");
  }


  const onlineDBUrl = process.env.ONLINE_DATABASE_URL;
  if (onlineDBUrl === undefined) {
    throw new Error("no onlineDBUrl field .env");
  }

  const onlineBackupDBUrl = process.env.ONLINE_BACKUP_DATABASE_URL;
  if (onlineBackupDBUrl === undefined) {
    throw new Error("no onlineBackupDBUrl field .env");
  }


	const db = new PrismaClient({log: ["warn", "error"]});
  const bdb = new PrismaClient({
    datasourceUrl: backupDBUrl,
  });
  const bdb2 = new PrismaClient({
    datasourceUrl: backupDB2Url,
  });
  const bdb3 = new PrismaClient({
    datasourceUrl: backupDB3Url,
  });

  const online_db = new PrismaClient({
    datasourceUrl: onlineDBUrl,
  });
  const online_bdb = new PrismaClient({
    datasourceUrl: onlineBackupDBUrl,
  });

	const makerConfig = await utils.parseMakerConfig(configDir, db);
  const starknetMakerConfig = await utils.parseStarknetMakerConfig(configDir, db);

	const chainConfig = await utils.parseChainConfig(configDir + "/chain-info.json", makerConfig);
  const dstChainConfig = await utils.parseDstChainConfig(configDir + "/dst-chain.list", chainConfig);
	const tokenConfig = await utils.parseTokenConfig(configDir + "/token-info.json", chainConfig);

	const makerAddress = makerConfig.getMakerAddress(env);
  const starknetMakerAddress = starknetMakerConfig.getMakerAddress(env);

	const networkConfig = await utils.parseNetworkConfig(configDir + "/maker.json", chainConfig);
	const txNetworkConfig = await utils.parseNetworkConfig(configDir + "/maker.bridge.json", chainConfig);
  
  const claimConfig = await utils.parseClaimConfig(configDir + "/claim-contract.json", chainConfig);
  const claimConfigV2 = await utils.parseClaimConfig(configDir + "/claim-contract-v2.json", chainConfig);

	const config = {
		dir: configDir,
		env: env,
		appid: appid,
    abi: new ethers.AbiCoder(),
		makerConfig: makerConfig,
    starknetMakerConfig: starknetMakerConfig,
		makerAddress: makerAddress,
    starknetMakerAddress: starknetMakerAddress,
		makerWatchCounterId: 99,
		chainConfig: chainConfig,
    dstChainConfig: dstChainConfig,
		tokenConfig: tokenConfig,
		networkConfig: networkConfig,
    txNetworkConfig: txNetworkConfig,
    claimConfig: claimConfig,
  	claimConfigV2: claimConfigV2,
		db: db,
    bdb: bdb,
    bdb2: bdb2,
    bdb3: bdb3,
    online_db: online_db,
    online_bdb: online_bdb,

		counterId: 99,
		sleepTime: 60,
		tokens: ["ETH"],
		gapValue: ethers.parseEther("5.0"),
	};
	return config;
}

export async function getBridgeConfig(
    configDir: string,
    appid: number,
    env: string | undefined = undefined): Promise<Config> {

	env = env || process.env.ENV;
	if (env === undefined) {
		throw new Error("no env field .env");
	}

  const backupDBUrl = process.env.BACKUP_DATABASE_URL;
  if (backupDBUrl === undefined) {
		throw new Error("no backupDBUrl field .env");
  }

  const backupDB2Url = process.env.BACKUP2_DATABASE_URL;
  if (backupDB2Url === undefined) {
		throw new Error("no backupDBUrl field .env");
  }

  const backupDB3Url = process.env.BACKUP3_DATABASE_URL;
  if (backupDB3Url === undefined) {
		throw new Error("no backupDBUrl field .env");
  }


  const onlineDBUrl = process.env.ONLINE_DATABASE_URL;
  if (onlineDBUrl === undefined) {
    throw new Error("no onlineDBUrl field .env");
  }

  const onlineBackupDBUrl = process.env.ONLINE_BACKUP_DATABASE_URL;
  if (onlineBackupDBUrl === undefined) {
    throw new Error("no onlineBackupDBUrl field .env");
  }


	const db = new PrismaClient({log: ["warn", "error"]});
  const bdb = new PrismaClient({
    datasourceUrl: backupDBUrl,
  });
  const bdb2 = new PrismaClient({
    datasourceUrl: backupDB2Url,
  });
  const bdb3 = new PrismaClient({
    datasourceUrl: backupDB3Url,
  });

  const online_db = new PrismaClient({
    datasourceUrl: onlineDBUrl,
  });
  const online_bdb = new PrismaClient({
    datasourceUrl: onlineBackupDBUrl,
  });

	const makerConfig = await utils.parseMakerConfig(configDir, db);
  const starknetMakerConfig = await utils.parseStarknetMakerConfig(configDir, db);

	const chainConfig = await utils.parseChainConfig(configDir + "/chain-info.json.getblock", makerConfig);
	const dstChainConfig = await utils.parseDstChainConfig(configDir + "/dst-chain.list", chainConfig);
	const tokenConfig = await utils.parseTokenConfig(configDir + "/token-info.json", chainConfig);

	const makerAddress = makerConfig.getMakerAddress(env);
  const starknetMakerAddress = starknetMakerConfig.getMakerAddress(env);

	const networkConfig = await utils.parseNetworkConfig(configDir + "/maker.json", chainConfig);
	const txNetworkConfig = await utils.parseNetworkConfig(configDir + "/maker.bridge.json", chainConfig);
  
  const claimConfig = await utils.parseClaimConfig(configDir + "/claim-contract.json", chainConfig);
  const claimConfigV2 = await utils.parseClaimConfig(configDir + "/claim-contract-v2.json", chainConfig);

	const config = {
		dir: configDir,
		env: env,
		appid: appid,
    abi: new ethers.AbiCoder(),
		makerConfig: makerConfig,
    starknetMakerConfig: starknetMakerConfig,
		makerAddress: makerAddress,
    starknetMakerAddress: starknetMakerAddress,
		makerWatchCounterId: 99,
		chainConfig: chainConfig,
    dstChainConfig: dstChainConfig,
		tokenConfig: tokenConfig,
		networkConfig: networkConfig,
    txNetworkConfig: txNetworkConfig,
    claimConfig: claimConfig,
	  claimConfigV2: claimConfigV2,
		db: db,
    bdb: bdb,
    bdb2: bdb2,
    bdb3: bdb3,
    online_db: online_db,
    online_bdb: online_bdb,

		counterId: 99,
		sleepTime: 60,
		tokens: ["ETH"],
		gapValue: ethers.parseEther("5.0"),
	};
	return config;
}

export interface EthersConfig {
	erc20TransferSignature: string,
	erc20Interface: ethers.Interface,
  transferContractSignature: string,
  transferContractInterface: ethers.Interface,
	abi: ethers.AbiCoder,
	erc20Abi: string,
}

export async function getEthersConfig(configDir: string): Promise<EthersConfig> {
	const erc20Abi = await utils.getErc20Abi(configDir + "/abi/ERC20.json");
	const abiObj = JSON.parse(erc20Abi);

  const transferContractAbi = await utils.getErc20Abi(configDir + "/abi/TransferContract.json");
  const transferObj = JSON.parse(transferContractAbi);

	return {
		erc20Abi: erc20Abi,
		abi: new ethers.AbiCoder(),
		erc20TransferSignature: utils.getErc20TransferSignature(),
		erc20Interface: ethers.Interface.from(abiObj),
    transferContractSignature: utils.getTransferContractSignature(),
    transferContractInterface: ethers.Interface.from(transferObj),
	}
}


