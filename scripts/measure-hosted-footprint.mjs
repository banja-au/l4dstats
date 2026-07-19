import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

function usage() {
  process.stderr.write(
    "usage: node scripts/measure-hosted-footprint.mjs path/to/workbench.sqlite path/to/artifact-root\n",
  );
  process.exitCode = 64;
}

const databasePath = process.argv[2];
const artifactRoot = process.argv[3];
if (!databasePath || !artifactRoot) {
  usage();
} else {
  const database = new DatabaseSync(resolve(databasePath), { readOnly: true });
  try {
    const tables = new Set(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map(({ name }) => String(name)),
    );
    if (!tables.has("job_analyses"))
      throw new Error("database has no job_analyses table");
    const analyses = database
      .prepare(
        `SELECT demo_sha256,engine_result_sha256,
                length(source_manifest_json) AS source_bytes,
                length(engine_result_json) AS result_bytes
         FROM job_analyses ORDER BY job_id`,
      )
      .all();
    const artifactBytes = await Promise.all(
      analyses.map(async ({ engine_result_sha256: hash }) => {
        const value = String(hash);
        try {
          return (
            await stat(
              resolve(artifactRoot, "sha256", value.slice(0, 2), value),
            )
          ).size;
        } catch (error) {
          if (error && typeof error === "object" && error.code === "ENOENT")
            return null;
          throw error;
        }
      }),
    );
    const telemetryByDemo = tables.has("telemetry_windows_v2")
      ? database
          .prepare(
            `SELECT demo_sha256,COUNT(*) AS chunks,SUM(length(payload_json)) AS bytes
             FROM telemetry_windows_v2 GROUP BY demo_sha256`,
          )
          .all()
      : [];
    const telemetry = new Map(
      telemetryByDemo.map((row) => [
        String(row.demo_sha256),
        { chunks: Number(row.chunks), bytes: Number(row.bytes ?? 0) },
      ]),
    );
    const samples = analyses.map((row, index) => ({
      sourceManifestBytes: Number(row.source_bytes),
      engineResultBytes: Number(row.result_bytes),
      engineArtifactBytes: artifactBytes[index],
      telemetryBytes: telemetry.get(String(row.demo_sha256))?.bytes ?? 0,
      telemetryChunks: telemetry.get(String(row.demo_sha256))?.chunks ?? 0,
    }));
    const distribution = (key) => {
      const values = samples
        .map((sample) => sample[key])
        .filter((value) => typeof value === "number")
        .sort((left, right) => left - right);
      const percentile = (fraction) =>
        values.length
          ? values[
              Math.min(values.length - 1, Math.floor(values.length * fraction))
            ]
          : null;
      return {
        count: values.length,
        total: values.reduce((sum, value) => sum + value, 0),
        median: percentile(0.5),
        p95: percentile(0.95),
        max: values.at(-1) ?? null,
      };
    };
    process.stdout.write(
      `${JSON.stringify(
        {
          schemaVersion: 1,
          analyses: samples.length,
          sourceManifestBytes: distribution("sourceManifestBytes"),
          engineResultBytes: distribution("engineResultBytes"),
          engineArtifactBytes: distribution("engineArtifactBytes"),
          telemetryBytes: distribution("telemetryBytes"),
          telemetryChunks: distribution("telemetryChunks"),
          limitations: [
            "Aggregate sizes only; raw demos and player identifiers are not emitted.",
            "Engine result JSON is currently duplicated in SQLite and the content-addressed artifact store.",
            "Compression and hosted-provider operation counts are not estimated.",
          ],
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    database.close();
  }
}
