export const MAX_IMAGE_EDGE = 2000;

export function scaledDimensions(
  w: number,
  h: number,
  maxEdge: number,
): { width: number; height: number } {
  const sourceWidth = Math.max(1, Math.round(w));
  const sourceHeight = Math.max(1, Math.round(h));
  const limit = Math.max(1, Math.floor(maxEdge));

  if (sourceWidth <= limit && sourceHeight <= limit) {
    return { width: sourceWidth, height: sourceHeight };
  }

  const scale = limit / Math.max(sourceWidth, sourceHeight);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}
