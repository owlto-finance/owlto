
export interface EventRecord {
  appid: number,
  chainid: number,
  tx_hash: string,
  block_number: number,
  log_index: number,
  sender: string, 
  token: string,
  maker: string,
  amount: string,
  lpid: string,
  sessionId: string,
  is_processed: number,
}

export interface TxSyncRecord {
  chainid: number, 
  tx_hash: string,
  block_number: number,
  sender: string,
  receiver: string,
  token: string,
  value: string,
  session_id: string,
  verification_hash: string,
}

export interface SrcSyncRecord {
  chainid: number,
  tx_hash: string,
  dst_chainid: number,
  sender: string,
  receiver: string,
  token: string,
  value: string,
  is_processed: number,
  is_invalid: number,
  is_testnet: number,
}

export interface NewSrcSyncRecord {
  chainid: number,
  tx_hash: string,
  src_nonce: number,
  dst_chainid: number | null,
  sender: string,
  receiver: string,
  target_address?: string,
  token: string,
  value: string,
  is_processed: number,
  is_invalid: number,
  is_testnet: number | null,
  src_token_name: string,
  src_token_decimal: number,
  is_cctp: number,
}

export interface DstSyncRecord {
  sender: string,
  receiver: string,
  value: string,
  dst_chainid: number,
  dst_tx_hash: string,
  is_verified: number,
}

export interface NewDstSyncRecord {
  sender: string,
  receiver: string,
  value: string,
  dst_chainid: number,
  dst_nonce: number,
  dst_tx_hash: string,
  is_verified: number,
}
