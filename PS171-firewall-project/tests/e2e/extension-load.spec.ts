import { test, expect } from "@playwright/test";
import path from "node:path";
import { existsSync, readFile, readFileSync } from "node:fs";
import http from "node:http";

async function startFixtureServer(): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const root = path.join(process.cwd(), "test-sites");
  const server = http.createServer((request, response) => {
    const requested = new URL(request.url ?? "/basic/", "http://localhost")
      .pathname;
    const file =
      requested === "/"
        ? "/basic/index.html"
        : `${requested.replace(/\/$/, "")}/index.html`;
    readFile(path.join(root, file), (error, data) => {
      if (error) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(data);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Fixture server did not expose a TCP port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
  };
}

test("packages a valid MV3 extension alongside the browser fixtures", async () => {
  const extensionPath = path.join(process.cwd(), "dist", "extension");
  expect(existsSync(path.join(extensionPath, "background.js"))).toBe(true);
  expect(existsSync(path.join(extensionPath, "content.js"))).toBe(true);
  const manifest = JSON.parse(
    readFileSync(path.join(extensionPath, "manifest.json"), "utf8")
  ) as { manifest_version: number; background?: { service_worker?: string } };
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.background?.service_worker).toBe("background.js");
  const fixture = await startFixtureServer();
  try {
    const response = await fetch(`${fixture.url}/basic/`);
    expect(response.ok).toBe(true);
  } finally {
    await fixture.close();
  }
});
