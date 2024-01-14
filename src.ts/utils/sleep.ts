export const sleep = async (waitTime: number) => new Promise(resolve => setTimeout(resolve, waitTime * 1000));
export const msleep = async (waitTime: number) => new Promise(resolve => setTimeout(resolve, waitTime));
