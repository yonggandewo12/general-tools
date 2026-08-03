export const HEADING_SIZE = 14;

export const HEADING_SIZES: { max: number; level: number }[] = [
  { max: 12, level: 5 },
  { max: 14, level: 4 },
  { max: 16, level: 3 },
  { max: 20, level: 2 },
  { max: 26, level: 1 },
];

export function headingLevelForSize(size: number): number {
  for (const h of HEADING_SIZES) {
    if (size <= h.max) return h.level;
  }
  return 1;
}
