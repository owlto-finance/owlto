export function bigint2Hex(value: bigint) {
  return '0x' + value.toString(16).toUpperCase();
}

export function isAllDigitString(value: string) {
  return /^\d+$/.test(value);
}
