import { promises as fs } from "fs";
import { ChainConfig } from './chain-config.js';

export class DstChainConfig {
  chains: Map<string, boolean>;
  chainIds: Array<number> = [];

  constructor(chains: Map<string, boolean>, chainConfig: ChainConfig) {
    this.chains = chains;
    for (const [chain, enable] of chains) {
      const chainId = chainConfig.getChainIdByName(chain);
      this.chainIds.push(chainId);
    }
    console.log(`dst chains: ${this.chainIds}`);
  }

  getChainIds() {
    return this.chainIds;
  }

  hasChain(chainName: string): boolean {
    const result = this.chains.get(chainName);
    if (result === undefined) {
      return false;
    }
    return result === true;
  }
}

export async function parseDstChainConfig(file: string, chainConfig: ChainConfig): Promise<DstChainConfig> {
  const result = new Map<string, boolean>();

  const data = await fs.readFile(file, 'utf8');
  const lines = data.split('\n');
  for (const l of lines) {
    const line = l.trim();
    if (line.startsWith('#')) {
      continue;
    }
    if (line.length === 0) {
      continue;
    }
    
    let chainName: string;
    let enabled: boolean;

    const parts = line.split(' ');
    if (parts.length === 1) {
      chainName = parts[0];
      enabled = true;
    } else if (parts.length === 2) {
      chainName = parts[0];
      if (parts[1] === "1" || parts[1] === 'true') {
        enabled = true;
      } else {
        enabled = false;
      }
    } else {
      continue;
    }

    if (chainConfig.hasNetworkName(chainName) !== true) {
      throw new Error(`${chainName} not found in dst_chain.list`);
    }

    if (enabled) {
      result.set(chainName, true);
    }
  }

  return new DstChainConfig(result, chainConfig);
}
