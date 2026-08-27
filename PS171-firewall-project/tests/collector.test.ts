import { beforeEach, describe, expect, it } from "vitest";
import { collectPageContext } from "../extension/src/browser/collector";
describe("browser sensor", () => {
  beforeEach(() => {
    document.body.innerHTML = `<h1>Order #39482</h1><form><input type="email" autocomplete="email"><input type="password" name="password"><button>Checkout</button></form><a href="/public">Read</a>`;
    Object.defineProperty(window, "innerWidth", {
      value: 1024,
      configurable: true
    });
  });
  it("collects structured DOM without password values", () => {
    const context = collectPageContext();
    expect(context.forms).toHaveLength(1);
    expect(
      context.elements.filter((e) => e.type === "password")[0]?.value
    ).toBeUndefined();
    expect(context.elements.some((e) => e.sensitive)).toBe(true);
    expect(context.elements.filter((e) => e.tag === "button")).toHaveLength(1);
  });
});
