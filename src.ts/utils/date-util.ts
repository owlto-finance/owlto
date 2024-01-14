export function formatDate(now: Date) {
  const year = now.getFullYear().toString();

  let month = (now.getMonth() + 1).toString();
  if (month.length < 2) {
    month = "0" + month;
  }

  let day = now.getDate().toString();
  if (day.length < 2) {
    day = "0" + day;
  }

  return year + month + day;
}

export function now() {
  const nowDate = new Date();
  const nowSeconds = Math.floor(nowDate.getTime() / 1000);
  return nowSeconds;
}
