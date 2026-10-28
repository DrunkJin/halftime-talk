// 시드 난수. 같은 시드면 같은 경기가 나온다.

// 문자열 시드도 받을 수 있도록 32비트 정수로 변환
function toSeed(seed) {
  if (Number.isInteger(seed)) return seed >>> 0;
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function createRng(seed) {
  let a = toSeed(seed);
  // mulberry32
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    // weights 배열에서 가중치에 비례해 인덱스 하나를 고른다 (전부 0이면 -1)
    weightedIndex(weights) {
      const total = weights.reduce((s, w) => s + w, 0);
      if (total <= 0) return -1;
      let r = next() * total;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r < 0) return i;
      }
      return weights.length - 1;
    },
  };
}

export function randomSeed() {
  return Math.floor(Math.random() * 2 ** 32);
}
