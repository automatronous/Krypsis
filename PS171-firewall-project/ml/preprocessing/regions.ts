import type { Rect, Region } from "../../extension/src/types/domain";
export function cropToRegion(
  source: Rect,
  region: Region,
  maxInputPixels: number
): Rect {
  const scale = Math.min(
    1,
    Math.sqrt(maxInputPixels / Math.max(1, region.width * region.height))
  );
  return {
    x: Math.max(source.x, region.x),
    y: Math.max(source.y, region.y),
    width: Math.max(1, Math.floor(region.width * scale)),
    height: Math.max(1, Math.floor(region.height * scale))
  };
}
export function regionHash(region: Region): string {
  return [
    region.x,
    region.y,
    region.width,
    region.height,
    region.hash ?? ""
  ].join(":");
}
