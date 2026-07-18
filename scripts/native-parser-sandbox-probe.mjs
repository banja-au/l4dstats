#!/usr/bin/env node

import { resolve } from "node:path";
import {
  probeNativeParserThroughLauncher,
  resolveNativeParserForBuild,
} from "./native-parser-contract.mjs";

const configuredPath = process.env.WITCHWATCH_NATIVE_STAGE;
const required = process.env.WITCHWATCH_REQUIRE_NATIVE_PARSER === "true";
const allowedRoot = process.env.WITCHWATCH_NATIVE_ALLOWED_ROOT ?? "/workspace";

const direct = await resolveNativeParserForBuild({
  configuredPath,
  required,
  allowedRoot,
});
if (!direct) {
  process.stdout.write(
    "Native parser sandbox probe skipped: this non-native build has no explicitly configured artifact.\n",
  );
  process.exit(0);
}

if (process.platform !== "linux") {
  process.stdout.write(
    `Native parser metadata passed for ${direct.version.parser}@${direct.version.version}; Linux sandbox probe skipped.\n`,
  );
  process.exit(0);
}

const launcher =
  process.env.WITCHWATCH_PARSER_SANDBOX ??
  resolve("apps/worker/dist/parser-no-network");
const sandboxed = await probeNativeParserThroughLauncher(
  direct.executable,
  launcher,
  {
    allowedRoot,
    launcherAllowedRoot:
      process.env.WITCHWATCH_SANDBOX_ALLOWED_ROOT ?? "/workspace",
  },
);
process.stdout.write(
  `Sandboxed native parser metadata passed for ${sandboxed.version.parser}@${sandboxed.version.version} (${sandboxed.version.buildSha256}).\n`,
);
