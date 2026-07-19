import { Container } from "@cloudflare/containers";
import { env } from "cloudflare:workers";
import type { EdgeEnvironment } from "./index.js";

const runtimeEnvironment = env as unknown as EdgeEnvironment;

export class AnalysisContainer extends Container<EdgeEnvironment> {
  override defaultPort = 8080;
  override sleepAfter = "1m";
  override enableInternet = false;
  override envVars = {
    L4DSTATS_PSEUDONYM_KEY: runtimeEnvironment.L4DSTATS_PSEUDONYM_KEY,
  };
}
