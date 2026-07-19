import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import {
  HostedJobRepository,
  TursoSqlClient,
  type HostedSource,
} from "@l4dstats/storage";
import type { EngineAnalysisResult } from "@l4dstats/worker";
import type { PendingDemo } from "./types.js";

const SHA256 = /^[a-f0-9]{64}$/;

export interface PublishResult {
  resultSha256: string;
  resultKey: string;
  jobId: string;
}

export interface Publisher {
  publish(input: {
    item: PendingDemo;
    sourceSha256: string;
    sourceBytes: number;
    demoSha256: string;
    result: EngineAnalysisResult;
    serialized: Uint8Array;
  }): Promise<PublishResult>;
  close(): void;
}

export class HostedPublisher implements Publisher {
  private readonly turso: TursoSqlClient;
  private readonly repository: HostedJobRepository;
  private readonly s3: S3Client;
  private readonly bucket: string;

  public constructor(
    environment: NodeJS.ProcessEnv = process.env,
    private readonly log: (message: string) => void = () => undefined,
  ) {
    this.bucket = environment.L4DSTATS_DERIVED_BUCKET ?? "";
    const endpoint = environment.CLOUDFLARE_R2_S3_API_ENDPOINT;
    const accessKeyId = environment.CLOUDFLARE_R2_ACCESS_KEY_ID;
    const secretAccessKey = environment.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
    if (!this.bucket) throw new Error("L4DSTATS_DERIVED_BUCKET is required");
    if (!endpoint || !accessKeyId || !secretAccessKey)
      throw new Error("Cloudflare R2 endpoint and credentials are required");
    this.turso = TursoSqlClient.fromEnvironment(environment);
    this.repository = new HostedJobRepository(this.turso);
    this.s3 = new S3Client({
      region: "auto",
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  public async publish(input: {
    item: PendingDemo;
    sourceSha256: string;
    sourceBytes: number;
    demoSha256: string;
    result: EngineAnalysisResult;
    serialized: Uint8Array;
  }): Promise<PublishResult> {
    if (input.result.demo.sha256 !== input.demoSha256)
      throw new Error("analysis demo SHA-256 does not match expanded demo");
    const resultSha256 = createHash("sha256")
      .update(input.serialized)
      .digest("hex");
    const resultKey = `sha256/${resultSha256.slice(0, 2)}/${resultSha256}`;
    this.log(
      `uploading derived artifact: key=${resultKey}, bytes=${input.serialized.byteLength}`,
    );
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: resultKey,
        Body: input.serialized,
        ContentType: "application/json",
        Metadata: { sha256: resultSha256, "demo-sha256": input.demoSha256 },
      }),
    );
    const confirmed = await this.s3.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: resultKey }),
    );
    if (
      confirmed.ContentLength !== input.serialized.byteLength ||
      confirmed.Metadata?.sha256 !== resultSha256 ||
      confirmed.Metadata?.["demo-sha256"] !== input.demoSha256
    )
      throw new Error("R2 did not confirm the derived artifact hash and size");
    this.log(`derived artifact verified in R2: ${resultKey}`);

    this.log("migrating/checking hosted Turso schema");
    await this.repository.migrate();
    const parser = input.result.demo.parser;
    if (!parser?.buildSha256 || !SHA256.test(parser.buildSha256))
      throw new Error("analysis parser lineage is incomplete");
    const idempotencyKey = [
      "local-backfill-v1",
      input.demoSha256,
      parser.buildSha256,
      parser.configVersion,
      parser.wireVersion,
    ].join(":");
    const source: HostedSource = {
      kind: "local-backfill",
      bucket: "local-source-not-uploaded",
      key: `${input.item.sourceId}/${input.item.sourceItemKey}`,
      sha256: input.sourceSha256,
      bytes: input.sourceBytes,
      filename: input.item.filename,
    };
    const job = await this.repository.enqueue(source, idempotencyKey);
    this.log(`hosted job ready: id=${job.id}, state=${job.state}`);
    const existing = await this.repository.getAnalysis(job.id);
    if (job.state === "succeeded") {
      if (!existing || existing.resultSha256 !== resultSha256)
        throw new Error(
          "completed backfill job conflicts with the local result",
        );
      return { resultSha256, resultKey, jobId: job.id };
    }
    const owner = `local-backfill-${process.pid}`;
    const claimed = await this.repository.claim({
      id: job.id,
      owner,
      leaseMs: 10 * 60_000,
    });
    if (!claimed)
      throw new Error("backfill job is currently leased by another publisher");
    try {
      await this.repository.recordAnalysis({
        jobId: job.id,
        demoSha256: input.demoSha256,
        resultKey,
        resultSha256,
        resultBytes: input.serialized.byteLength,
        engineResult: input.result,
      });
      this.log(
        `hosted analysis and game/player indexes committed: job=${job.id}`,
      );
      await this.repository.finish({ id: job.id, owner, state: "succeeded" });
      this.log(`hosted job succeeded: id=${job.id}`);
    } catch (error) {
      await this.repository
        .finish({
          id: job.id,
          owner,
          state: "failed",
          message:
            error instanceof Error
              ? error.message.slice(0, 2_000)
              : "backfill publish failed",
        })
        .catch(() => undefined);
      throw error;
    }
    return { resultSha256, resultKey, jobId: job.id };
  }

  public close(): void {
    this.s3.destroy();
    this.turso.close();
  }
}
