import * as utils from "../utils/index.js";
import { t_lp_info } from "@prisma/client";

export class LpInfos {
  chainConfig: utils.ChainConfig;
  tokenConfig: utils.TokenConfig;
  lps: Array<t_lp_info>;
  infosByKey: Map<string, t_lp_info> = new Map<string, t_lp_info>();

  constructor(chainConfig: utils.ChainConfig, tokenConfig: utils.TokenConfig, lps: Array<t_lp_info>) {
    this.chainConfig = chainConfig;
    this.tokenConfig = tokenConfig;
    this.lps = lps;

    for (const lp of lps) {
      const tokenName = lp.token_name;
      const fromChainName = lp.from_chain;
      const toChainName = lp.to_chain;
      const makerAddress = lp.maker_address;
      const key = `${tokenName}-${fromChainName}-${toChainName}-${makerAddress}`;
      this.infosByKey.set(key, lp);
    }
  }

  getLpInfo(tokenName: string, fromChainName: string, toChainName: string, makerAddress: string) {
    const key = `${tokenName}-${fromChainName}-${toChainName}-${makerAddress}`;
    return this.infosByKey.get(key);
  }

  getTokens(needBaseChainId: number) {
    const flag = new Set<string>();
    const result = [];
    for (const lp of this.lps) {
      const tokenName = lp.token_name;
      const fromChainName = lp.from_chain;
      const baseChainId = this.chainConfig.getLayer1ChainInfoOrSelf(fromChainName).chainId;
      if (baseChainId !== needBaseChainId) {
        continue;
      }

      if (flag.has(tokenName)) {
        continue;
      }

      const baseTokenInfo = this.tokenConfig.getInfoBySymbolAndChainId(tokenName, baseChainId);

      result.push({
        symbol: tokenName,
        decimal: baseTokenInfo.decimal,
        chainId: baseChainId,
        address: baseTokenInfo.address,
      });
      flag.add(tokenName);
    }

    return result;
  }

}
