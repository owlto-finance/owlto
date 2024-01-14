import { ethers } from "ethers";
import { promises as fs } from "fs";

export async function getErc20Abi(file: string) {
  const content = await fs.readFile(file, "utf-8");
  return content;
	//const obj = JSON.parse(content);
	//return obj.abi;
}

export async function getTransferContractAbi(file: string) {
  const content = await fs.readFile(file, "utf-8");
  return content;
}

export function getErc20TransferSignature() {
  return "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
}

export function getTransferContractSignature() {
  return "0x673a534e56ef22312f97f00524e3ab12066b624575e63f01a9b579ce40cffac9";
}

export function getClaimSignature() {
  return "0x2f6639d24651730c7bf57c95ddbf96d66d11477e4ec626876f92c22e5f365e68";
}
