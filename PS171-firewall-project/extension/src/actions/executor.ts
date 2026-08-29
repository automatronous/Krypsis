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
  // Try by CSS selector, then by aria-label, then by visible text
  try {
    const el = document.querySelector(selector);
    if (el) return el;
  } catch {
    // Invalid CSS selector — fall through to text search
  }
  // Try id or name attribute
  const byId = document.getElementById(selector);
  if (byId) return byId;
  const byName = document.querySelector(`[name="${selector}"]`);
  if (byName) return byName;
  // Try by aria-label
  const byAria = document.querySelector(`[aria-label="${selector}"]`);
  if (byAria) return byAria;
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
