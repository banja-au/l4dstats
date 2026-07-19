import { execFileSync, spawnSync } from "node:child_process";
import process from "node:process";

const environment = {
  ...process.env,
  L4DSTATS_API_TOKEN: "compose-check-api-token-0123456789",
  L4DSTATS_PSEUDONYM_KEY: "compose-check-pseudonym-key-0123456789",
  L4DSTATS_WEB_USERNAME: "compose-check",
  L4DSTATS_WEB_PASSWORD: "compose-check-password",
};

function render() {
  const plugin = spawnSync("docker", ["compose", "version"], {
    encoding: "utf8",
  });
  if (plugin.status === 0)
    return execFileSync(
      "docker",
      ["compose", "-f", "compose.production.yaml", "config"],
      {
        cwd: new URL("..", import.meta.url),
        env: environment,
        encoding: "utf8",
      },
    );
  try {
    return execFileSync(
      "docker-compose",
      ["-f", "compose.production.yaml", "config"],
      {
        cwd: new URL("..", import.meta.url),
        env: environment,
        encoding: "utf8",
      },
    );
  } catch {
    throw new Error(
      "Docker Compose is required to validate production configuration",
    );
  }
}

const config = render();
for (const service of ["api", "worker", "web"])
  if (!new RegExp(`^  ${service}:$`, "m").test(config))
    throw new Error(`production service is absent: ${service}`);
if (!config.includes("0.0.0.0:5173:5173"))
  throw new Error("authenticated web port is not published on 0.0.0.0:5173");
if (/0\.0\.0\.0:8787:8787/.test(config))
  throw new Error("internal API port 8787 is published");
if ((config.match(/read_only: true/g) ?? []).length !== 3)
  throw new Error(
    "every production service must use a read-only root filesystem",
  );
if ((config.match(/no-new-privileges:true/g) ?? []).length !== 3)
  throw new Error(
    "every production service must prohibit privilege escalation",
  );
if ((config.match(/- ALL/g) ?? []).length < 3)
  throw new Error("every production service must drop all capabilities");
process.stdout.write("Production Compose configuration passed.\n");
