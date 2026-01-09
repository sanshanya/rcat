export const arrayChunk = (values: ArrayLike<number>, stride: number): number[][] => {
  const result: number[][] = [];
  const length = values.length;
  for (let index = 0; index < length; index += stride) {
    const chunk: number[] = [];
    for (let offset = 0; offset < stride && index + offset < length; offset += 1) {
      chunk.push(values[index + offset]);
    }
    result.push(chunk);
  }
  return result;
};

