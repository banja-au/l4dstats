import { createServer } from "node:http";

try {
  await import("/workspace/apps/worker/dist/hosted-main.js");
} catch (error) {
  const detail =
    error instanceof Error
      ? `${error.name}: ${error.message}`.slice(0, 2_000)
      : "unknown hosted server startup error";
  console.error(
    JSON.stringify({ event: "hosted.server.startup.failed", detail }),
  );
  createServer((_request, response) => {
    response.writeHead(500, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    response.end(`${JSON.stringify({ error: detail })}\n`);
  }).listen(8080, "0.0.0.0");
}
