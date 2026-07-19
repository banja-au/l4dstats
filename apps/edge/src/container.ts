import { Container } from "@cloudflare/containers";
import type { EdgeEnvironment } from "./index.js";

export class AnalysisContainer extends Container<EdgeEnvironment> {
  override defaultPort = 8080;
  override sleepAfter = "1m";
  override enableInternet = false;
  override envVars = {
    L4DSTATS_PSEUDONYM_KEY: this.env.L4DSTATS_PSEUDONYM_KEY,
  };
}
