import axios from "axios";
import { PrismaClient } from "@prisma/client";

export async function fetchEthPrice(): Promise<number> {
  const url = "https://pro-api.coingecko.com/api/v3/simple/price?ids=weth&vs_currencies=usd&x_cg_pro_api_key=CG-2j4NfTm82pz3oz24VBR8SDwx";

  const response = await axios.get(url);
  if (response.status !== 200) {
    throw new Error(`Failed to fetch ETH price from ${url}`);
  }

  const data = response.data;
  if ("weth" in data && "usd" in data.weth) {
    return data.weth.usd;
  } else {
    throw new Error("Failed to extract ETH price");
  }
}

export async function fetchBTCPrice(): Promise<number> {
  const url = "https://pro-api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&x_cg_pro_api_key=CG-2j4NfTm82pz3oz24VBR8SDwx";

  const response = await axios.get(url);
  if (response.status !== 200) {
    throw new Error(`Failed to fetch BTC price from ${url}`);
  }

  const data = response.data;
  if ("bitcoin" in data && "usd" in data.bitcoin) {
    return data.bitcoin.usd;
  } else {
    throw new Error("Failed to extract BTC price");
  }
}

export async function fetchBnbPrice(): Promise<number> {
  const url = "https://pro-api.coingecko.com/api/v3/simple/price?ids=wbnb&vs_currencies=usd&x_cg_pro_api_key=CG-2j4NfTm82pz3oz24VBR8SDwx";

  const response = await axios.get(url);
  if (response.status !== 200) {
    throw new Error(`Failed to fetch BNB price from ${url}`);
  }

  const data = response.data;
  if ("wbnb" in data && "usd" in data.wbnb) {
    return data.wbnb.usd;
  } else {
    throw new Error("Failed to extract BNB price");
  }
}

export async function fetchMntPrice(): Promise<number> {
  const url = "https://pro-api.coingecko.com/api/v3/simple/price?ids=wrapped-mantle&vs_currencies=usd&x_cg_pro_api_key=CG-2j4NfTm82pz3oz24VBR8SDwx";

  const response = await axios.get(url);
  if (response.status !== 200) {
    throw new Error(`Failed to fetch MNT price from ${url}`);
  }

  const data = response.data;
  if ("wrapped-mantle" in data && "usd" in data["wrapped-mantle"]) {
    return data["wrapped-mantle"].usd;
  } else {
    throw new Error("Failed to extract MNT price");
  }
}

export async function fetchMaticPrice(): Promise<number> {
  const url = "https://pro-api.coingecko.com/api/v3/simple/price?ids=wmatic&vs_currencies=usd&x_cg_pro_api_key=CG-2j4NfTm82pz3oz24VBR8SDwx";

  const response = await axios.get(url);
  if (response.status !== 200) {
    throw new Error(`Failed to fetch MATIC price from ${url}`);
  }

  const data = response.data;
  if ("wmatic" in data && "usd" in data.wmatic) {
    return data.wmatic.usd;
  } else {
    throw new Error("Failed to extract MATIC price");
  }
}

export function isStableCoin(tokenName: string): boolean {
  return tokenName === "USDC" || tokenName === "USDT" || tokenName === "DAI";
}

export function isUsdcOrUsdt(tokenName: string): boolean {
  return tokenName === "USDC" || tokenName === "USDT";
}

export async function isCCTP(db: PrismaClient, tokenName: string, fromChainid: number, toChainid: number, amount: string): Promise<boolean> {
  if (tokenName === "USDC") {
    const from = await db.t_cctp_support_chain.findUnique({
      where: {
        chainid: fromChainid,
      },
    });
    const to = await db.t_cctp_support_chain.findUnique({
      where: {
        chainid: toChainid,
      },
    });
    if (from === null || to === null) {
      return false;
    }
    if (parseInt(to.min_value) <= parseInt(amount)) {
      return true;
    }
  }
  return false;
}


export async function getCCTP_DTC(db: PrismaClient, fromChainid: number, toChainid: number): Promise<string> {
  const from = await db.t_cctp_support_chain.findUnique({
    where: {
      chainid: fromChainid,
    },
  });
  const to = await db.t_cctp_support_chain.findUnique({
    where: {
      chainid: toChainid,
    },
  });
  if (from === null || to === null) {
    throw new Error("Failed to get CCTP_DTC");
  }
  if (fromChainid === 1 || toChainid === 1) {
    return "20";
  }
  return "3";
}

