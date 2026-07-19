#!/usr/bin/env node
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { HostedJobRepository, TursoSqlClient } from "@l4dstats/storage";

export async function backfillHostedStats(
  environment: NodeJS.ProcessEnv = process.env,
  log: (message: string) => void = (message) =>
    process.stdout.write(`${message}\n`),
): Promise<number> {
  const bucket = environment.L4DSTATS_DERIVED_BUCKET;
  const endpoint = environment.CLOUDFLARE_R2_S3_API_ENDPOINT;
  const accessKeyId = environment.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = environment.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey)
    throw new Error(
      "hosted stats backfill requires Turso and R2 configuration",
    );
  const turso = TursoSqlClient.fromEnvironment(environment);
  const repository = new HostedJobRepository(turso);
  const s3 = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
  let completed = 0;
  try {
    await repository.migrate();
    for (;;) {
      const pending = await repository.listAnalysesNeedingStats(50);
      if (!pending.length) break;
      for (const reference of pending) {
        log(`materializing stats: ${reference.jobId}`);
        const response = await s3.send(
          new GetObjectCommand({ Bucket: bucket, Key: reference.resultKey }),
        );
        if (!response.Body)
          throw new Error(`missing R2 body: ${reference.resultKey}`);
        const bytes = await response.Body.transformToByteArray();
        const digest = createHash("sha256").update(bytes).digest("hex");
        if (
          bytes.byteLength !== reference.resultBytes ||
          digest !== reference.resultSha256
        )
          throw new Error(
            `derived artifact verification failed: ${reference.jobId}`,
          );
        const result = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
        await repository.assignAnalysisToGame({
          jobId: reference.jobId,
          demoSha256: reference.demoSha256,
          engineResult: result,
        });
        completed += 1;
        log(`materialized stats ${completed}: ${reference.jobId}`);
      }
    }
    return completed;
  } finally {
    s3.destroy();
    turso.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href
)
  backfillHostedStats().then(
    (count) =>
      process.stdout.write(`hosted stats backfill complete: ${count}\n`),
    (error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    },
  );
