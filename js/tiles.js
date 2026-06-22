export const TILE_DISTRIBUTION = {
  A:13, B:3, C:3, D:6, E:18, F:3, G:4, H:3, I:12, J:2, K:2,
  L:5,  M:3, N:8, O:11, P:3, Q:2, R:9, S:6, T:9, U:6, V:3, W:3, X:2, Y:3, Z:2,
};

export const TOTAL_TILES = Object.values(TILE_DISTRIBUTION).reduce((a, b) => a + b, 0); // 144

let _uid = 0;

export function createBag() {
  const bag = [];
  for (const [letter, count] of Object.entries(TILE_DISTRIBUTION)) {
    for (let i = 0; i < count; i++) {
      bag.push({ letter, id: `t${++_uid}` });
    }
  }
  return bag;
}

export function shuffleBag(bag) {
  const arr = [...bag];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
