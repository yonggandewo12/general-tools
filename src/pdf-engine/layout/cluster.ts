export function clusterSortedByGap(values: number[], gap: number): number[][] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const groups: number[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const lastGroup = groups[groups.length - 1];
    if (sorted[i] - lastGroup[lastGroup.length - 1] > gap) {
      groups.push([]);
    }
    groups[groups.length - 1].push(sorted[i]);
  }
  return groups;
}
