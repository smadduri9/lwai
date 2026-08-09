/** Shared constellation graph geometry (tile space). */

export const TILE_W = 180;
export const TILE_H = 160;

/** Primary star positions [x, y, radius]. */
export const CONSTELLATION_POINTS: Array<[number, number, number]> = [
  [20, 24, 1.6],
  [66, 12, 1.1],
  [118, 30, 1.9],
  [160, 14, 1.2],
  [38, 66, 1.3],
  [92, 58, 2.1],
  [142, 74, 1.4],
  [16, 110, 1.9],
  [64, 122, 1.2],
  [112, 108, 1.6],
  [164, 118, 2.0],
  [44, 150, 1.4],
  [96, 148, 1.1],
  [148, 148, 1.5],
];

export const CONSTELLATION_EDGES: Array<[number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [0, 4],
  [1, 5],
  [2, 5],
  [4, 5],
  [5, 6],
  [3, 6],
  [4, 7],
  [7, 8],
  [8, 9],
  [6, 9],
  [9, 10],
  [8, 11],
  [9, 12],
  [10, 13],
  [11, 12],
  [12, 13],
];

export const CONSTELLATION_WRAP: Array<[number, number, number, number]> = [
  [3, 0, 1, 0],
  [13, 1, 0, 1],
  [10, 4, 1, 0],
];

const primaryEdgeKey = new Set(
  CONSTELLATION_EDGES.map(([a, b]) => (a < b ? `${a}-${b}` : `${b}-${a}`)),
);

/**
 * Alternate connectivity on the SAME dots — does not duplicate primary edges.
 * Used during EM shock as the jiggly “other constellation.”
 */
export const SHOCK_EDGES: Array<[number, number]> = ([
  [0, 2],
  [0, 5],
  [1, 3],
  [1, 4],
  [2, 6],
  [3, 5],
  [3, 10],
  [4, 8],
  [4, 11],
  [5, 7],
  [5, 9],
  [6, 8],
  [6, 10],
  [6, 12],
  [7, 9],
  [7, 11],
  [8, 10],
  [8, 13],
  [9, 13],
  [10, 12],
  [11, 13],
  [0, 7],
  [2, 9],
  [1, 6],
] as Array<[number, number]>).filter(([a, b]) => {
  const k = a < b ? `${a}-${b}` : `${b}-${a}`;
  return !primaryEdgeKey.has(k);
});
