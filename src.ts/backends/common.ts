export function constructBlockRange(
    from: number,
    to: number,
    gappedBlockNumbers: number[] | null = null) {

	const result: Array<number> = [];
	for (let i = from; i <= to; i++) {
		result.push(i);
	}

  if (gappedBlockNumbers !== null) {
	  for (let i = 0; i < gappedBlockNumbers.length; i++) {
      const num = gappedBlockNumbers[i];
		  if (num >= from && num <= to) {
			  continue;
		  }
		  result.push(num);
	  }
  }

	return result;
}
