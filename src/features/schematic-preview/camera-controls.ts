export function clampCameraDistance(
  currentDistance: number,
  factor: number,
  minimumDistance: number,
  maximumDistance: number,
): number {
  if (
    !Number.isFinite(currentDistance) ||
    !Number.isFinite(factor) ||
    !Number.isFinite(minimumDistance) ||
    !Number.isFinite(maximumDistance) ||
    currentDistance <= 0 ||
    factor <= 0
  ) {
    return currentDistance;
  }

  const lower = Math.min(minimumDistance, maximumDistance);
  const upper = Math.max(minimumDistance, maximumDistance);
  return Math.min(upper, Math.max(lower, currentDistance * factor));
}
