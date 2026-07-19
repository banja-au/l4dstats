import { Container, type StopParams } from "@cloudflare/containers";
import { env } from "cloudflare:workers";
import type { EdgeEnvironment } from "./index.js";

const runtimeEnvironment = env as unknown as EdgeEnvironment;

export class AnalysisContainer extends Container<EdgeEnvironment> {
  override defaultPort = 8080;
  override entrypoint = [
    "node",
    "/workspace/deploy/cloudflare/container/launcher.mjs",
  ];
  override sleepAfter = "1m";
  override enableInternet = false;
  override envVars = {
    L4DSTATS_PSEUDONYM_KEY: runtimeEnvironment.L4DSTATS_PSEUDONYM_KEY,
  };

  override onStop({ exitCode, reason }: StopParams): void {
    console.error(
      JSON.stringify({
        event: "hosted.container.stopped",
        exitCode,
        reason,
      }),
    );
  }
}
