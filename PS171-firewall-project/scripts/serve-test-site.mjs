import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
const root = path.join(process.cwd(), "test-sites");
const server = http.createServer(async (req, res) => {
  const requested = new URL(req.url ?? "/basic", "http://localhost").pathname;
  const file =
    requested === "/"
      ? "/basic/index.html"
      : requested.endsWith(".html")
        ? requested
        : `${requested}/index.html`;
  try {
    const data = await readFile(path.join(root, file));
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'self' 'unsafe-inline'"
    });
    res.end(data);
  } catch (error) {
    res.writeHead(404);
    res.end("Not found");
  }
});
const stop = () => server.close(() => process.exit(0));
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
server.listen(4173, "127.0.0.1", () =>
  console.log("PS171 test site: http://127.0.0.1:4173/basic/")
);
