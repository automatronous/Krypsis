import { detectElement } from "../security/pii";
import type {
  FormInfo,
  IFrameInfo,
  PageContext,
  PageElement,
  Rect
} from "../types/domain";
function rectOf(element: Element): Rect {
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}
function isVisible(element: Element): boolean {
  const html = element as HTMLElement;
  const style =
    typeof getComputedStyle === "function" ? getComputedStyle(html) : undefined;
  const rect = html.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style?.display !== "none" &&
    style?.visibility !== "hidden"
  );
}
function attributes(element: Element): Record<string, string> {
  return Object.fromEntries(
    Array.from(element.attributes)
      .filter((a) => a.name !== "value")
      .map((a) => [a.name, a.value])
  );
}
export function collectPageContext(): PageContext {
  const allElements = Array.from(
    document.querySelectorAll(
      "button, a, input, textarea, select, [role], [contenteditable='true'], img, picture, h1, h2, h3, h4, h5, h6, p, span, div, b, strong, td, th, li, [class*='name'], [class*='author'], [class*='profile'], [class*='user']"
    )
  );

  const elementsToProcess = allElements.filter((el) => {
    const tag = el.tagName.toLowerCase();
    if (
      [
        "button",
        "a",
        "input",
        "textarea",
        "select",
        "img",
        "picture",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "p",
        "b",
        "strong"
      ].includes(tag)
    ) {
      return true;
    }
    const txt = (el.textContent ?? "").trim();
    return txt.length > 0 && txt.length <= 150 && el.children.length <= 2;
  });

  const elements: PageElement[] = elementsToProcess.map((element, index) => {
    const input = element as HTMLInputElement;
    const generatedId = `ps171-${index + 1}`;
    const id = element.id || generatedId;
    if (!element.id) {
      element.setAttribute("data-ps171-id", generatedId);
    }
    const elementData: PageElement = {
      id,
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role") ?? undefined,
      text:
        (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 300) ||
        undefined,
      type: input.type || undefined,
      ariaLabel: element.getAttribute("aria-label") ?? undefined,
      placeholder: input.placeholder || undefined,
      name: input.name || undefined,
      value: input.type === "password" ? undefined : input.value || undefined,
      rect: rectOf(element),
      attributes: attributes(element),
      visible: isVisible(element),
      enabled: !input.disabled,
      sensitive: false
    };
    elementData.sensitive = detectElement(elementData).some(
      (d) => d.confidence >= 0.85
    );
    return elementData;
  });
  const forms: FormInfo[] = Array.from(document.forms).map((form, index) => ({
    id: form.id || `form-${index + 1}`,
    action: form.action,
    method: form.method || "get",
    fieldCount: form.elements.length,
    hasPassword: Boolean(form.querySelector("input[type=password]"))
  }));
  const iframes: IFrameInfo[] = Array.from(
    document.querySelectorAll("iframe")
  ).map((frame) => {
    let sameOrigin = false;
    try {
      void frame.contentDocument;
      sameOrigin = true;
    } catch (error) {
      sameOrigin = false;
    }
    let origin = "unknown";
    try {
      origin = new URL(frame.src || location.href).origin;
    } catch (error) {
      origin = "unknown";
    }
    return { src: frame.src, origin, sameOrigin };
  });
  return {
    url: location.href,
    title: document.title,
    pageText: (document.body?.innerText ?? "").slice(0, 20000),
    elements,
    forms,
    iframes,
    changedRegions: [],
    screenshotRegions: [],
    timestamp: Date.now(),
    mutationCount: 0,
    devicePixelRatio: window.devicePixelRatio || 1,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight
  };
}
