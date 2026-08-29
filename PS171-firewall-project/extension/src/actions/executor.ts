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
