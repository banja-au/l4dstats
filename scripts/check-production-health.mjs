import process from "node:process";

const baseUrl = process.env.L4DSTATS_HEALTH_URL ?? "http://127.0.0.1:5173";
const username = process.env.L4DSTATS_WEB_USERNAME;
const password = process.env.L4DSTATS_WEB_PASSWORD;
if (!username || !password) {
  process.stderr.write(
    "L4DSTATS_WEB_USERNAME and L4DSTATS_WEB_PASSWORD are required.\n",
  );
  process.exitCode = 2;
} else {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(new URL("/health", baseUrl), {
      headers: {
        authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
      },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.ok !== true || body?.checks?.database !== true)
      throw new Error(`health check failed with HTTP ${response.status}`);
    process.stdout.write("Web, API and database readiness passed.\n");
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "health check failed"}\n`,
    );
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
  }
}
