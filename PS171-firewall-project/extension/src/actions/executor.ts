/**
 * executor.ts
 * Executes agent actions inside the browser tab (content script context).
 * Each action is dispatched as a real DOM event so the page handles it naturally.
 */

import type { AgentAction } from "../types/domain";

export interface ExecutionResult {
  actionIndex: number;
  type: string;
  selector?: string;
  success: boolean;
  error?: string;
}

function findElement(selector: string): Element | null {
  if (!selector) return null;
  const cleanSel = selector.trim();

  // 1. Try direct querySelector
  try {
    const el = document.querySelector(cleanSel);
    if (el) return el;
  } catch {
    /* invalid CSS selector format */
  }

  // 2. Try by element ID
  const rawId = cleanSel.replace(/^#/, "");
  const byId = document.getElementById(rawId);
  if (byId) return byId;

  // 3. Try by data-ps171-id attribute (generated during context collection)
  const byPs171Id = document.querySelector(`[data-ps171-id="${rawId}"]`) || document.querySelector(`[data-ps171-id="${cleanSel}"]`);
  if (byPs171Id) return byPs171Id;

  // 4. Try by name or aria-label
  const byName = document.querySelector(`[name="${rawId}"]`);
  if (byName) return byName;
  const byAria = document.querySelector(`[aria-label="${rawId}"]`) || document.querySelector(`[aria-label="${cleanSel}"]`);
  if (byAria) return byAria;

  // 5. Fallback: match by text content (e.g. "Checkout", "Shopping Cart")
  const allInteractables = document.querySelectorAll("a, button, input, [role]");
  for (const item of Array.from(allInteractables)) {
    const text = (item.textContent ?? "").trim().toLowerCase();
    if (text && (text === cleanSel.toLowerCase() || text.includes(cleanSel.toLowerCase()))) {
      return item;
    }
  }

  return null;
}

function simulateInput(el: HTMLInputElement, value: string): void {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )?.set;
  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export async function executeAction(
  action: AgentAction,
  index: number
): Promise<ExecutionResult> {
  try {
    switch (action.type) {
      case "CLICK": {
        const el = action.selector ? findElement(action.selector) : null;
        if (!el) {
          return { actionIndex: index, type: "CLICK", selector: action.selector, success: false, error: "Element not found" };
        }
        (el as HTMLElement).focus();
        (el as HTMLElement).click();
        return { actionIndex: index, type: "CLICK", selector: action.selector, success: true };
      }

      case "TYPE": {
        const el = action.selector ? findElement(action.selector) : null;
        if (!el) {
          return { actionIndex: index, type: "TYPE", selector: action.selector, success: false, error: "Element not found" };
        }
        (el as HTMLElement).focus();
        simulateInput(el as HTMLInputElement, action.value ?? "");
        return { actionIndex: index, type: "TYPE", selector: action.selector, success: true };
      }

      case "SCROLL": {
        const y = action.scrollY ?? 300;
        window.scrollBy({ top: y, behavior: "smooth" });
        return { actionIndex: index, type: "SCROLL", success: true };
      }

      case "NAVIGATE": {
        if (action.url) {
          window.location.href = action.url;
          return { actionIndex: index, type: "NAVIGATE", success: true };
        }
        return { actionIndex: index, type: "NAVIGATE", success: false, error: "No URL provided" };
      }

      case "SUBMIT": {
        const el = action.selector ? findElement(action.selector) : null;
        if (el) {
          const form = el.closest("form") ?? (el as HTMLFormElement);
          if (form && form instanceof HTMLFormElement) {
            form.requestSubmit();
            return { actionIndex: index, type: "SUBMIT", selector: action.selector, success: true };
          }
        }
        return { actionIndex: index, type: "SUBMIT", selector: action.selector, success: false, error: "Form not found" };
      }

      case "INJECT_STYLE": {
        injectPageWaterBackground();
        return { actionIndex: index, type: "INJECT_STYLE", success: true };
      }

      default:
        return { actionIndex: index, type: action.type, success: false, error: `Unsupported action type: ${action.type}` };
    }
  } catch (err) {
    return {
      actionIndex: index,
      type: action.type,
      selector: action.selector,
      success: false,
      error: err instanceof Error ? err.message : "Unknown execution error"
    };
  }
}

function injectPageWaterBackground() {
  let canvas = document.getElementById("ps171-water-bg") as HTMLCanvasElement | null;
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = "ps171-water-bg";
    canvas.style.position = "fixed";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.width = "100vw";
    canvas.style.height = "100vh";
    canvas.style.zIndex = "-99999";
    canvas.style.pointerEvents = "none";
    document.body.prepend(canvas);

    // Make body background transparent so the canvas water background shows through
    document.body.style.backgroundColor = "transparent";
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  function resize() {
    canvas!.width = window.innerWidth;
    canvas!.height = window.innerHeight;
  }
  resize();
  window.addEventListener("resize", resize);

  let time = 0;
  function draw() {
    time += 0.015;
    const w = canvas!.width;
    const h = canvas!.height;

    ctx!.fillStyle = "#06090e";
    ctx!.fillRect(0, 0, w, h);

    ctx!.lineWidth = 1.2;
    const numRipples = 14;
    for (let i = 0; i < numRipples; i++) {
      ctx!.beginPath();
      const offset = (i / numRipples) * Math.PI * 2;
      const alpha = 0.15 + Math.sin(time + offset) * 0.08;
      ctx!.strokeStyle = `rgba(56, 189, 248, ${Math.max(0.05, alpha)})`;

      for (let x = 0; x <= w; x += 12) {
        const y =
          (h / (numRipples + 1)) * (i + 1) +
          Math.sin(x * 0.02 + time * 1.5 + offset) * 16 +
          Math.cos(x * 0.035 - time * 0.8 + offset) * 10;

        if (x === 0) ctx!.moveTo(x, y);
        else ctx!.lineTo(x, y);
      }
      ctx!.stroke();
    }

    for (let i = 0; i < 10; i++) {
      ctx!.beginPath();
      const offset = (i / 10) * Math.PI * 1.5;
      const alpha = 0.1 + Math.cos(time * 1.2 + offset) * 0.05;
      ctx!.strokeStyle = `rgba(20, 184, 166, ${Math.max(0.03, alpha)})`;

      for (let y = 0; y <= h; y += 16) {
        const x =
          (w / 11) * (i + 1) +
          Math.sin(y * 0.025 + time * 1.1 + offset) * 14 +
          Math.sin(y * 0.015 - time * 1.4) * 8;

        if (y === 0) ctx!.moveTo(x, y);
        else ctx!.lineTo(x, y);
      }
      ctx!.stroke();
    }

    requestAnimationFrame(draw);
  }

  requestAnimationFrame(draw);
}
