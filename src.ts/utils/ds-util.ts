// check if key is a key of enumObject
//export function isKeyOfEnum<T>(enumObject: T extends object, key: string): boolean {
//  return key in enumObject;
//}
//

export function split<T>(array: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}
