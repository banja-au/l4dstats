#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const path = process.argv[2];
const delay = Number(process.env.FAKE_BENCH_DELAY_MS ?? 0);
if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
process.stdout.write(`${digest}\n`);
