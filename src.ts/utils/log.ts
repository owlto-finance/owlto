// logging with date and time
export function log(...args: any[]) {
  const now = new Date();
  const timeString = now.toLocaleString();
  console.log(`${timeString}:`, ...args);
}
