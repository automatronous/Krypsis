import type { PageContext } from "../types/domain";
export type PerceptionRoute =
  "DOM_ONLY" | "DOM_RULES" | "VISION_FALLBACK" | "UNAVAILABLE";
export function chooseRoute(
  context: PageContext,
  taskGoal: string,
  visionAvailable: boolean
): PerceptionRoute {
  const relevant = taskGoal.toLowerCase();
  const hasUsefulDom = context.elements.some(
    (element) =>
      element.visible &&
      ((element.text ?? element.ariaLabel ?? "")
        .toLowerCase()
        .includes(relevant) ||
        ["button", "a", "input"].includes(element.tag))
  );
  if (hasUsefulDom) return "DOM_RULES";
  if (visionAvailable && context.screenshotRegions.length > 0)
    return "VISION_FALLBACK";
  return visionAvailable ? "DOM_ONLY" : "UNAVAILABLE";
}
