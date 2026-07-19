import {
  createClient,
  type Client,
  type InValue,
  type ResultSet,
  type Transaction,
} from "@libsql/client";

import type {
  AsyncSqlClient,
  AsyncSqlTransaction,
  SqlResult,
} from "./hosted.js";

function result(value: ResultSet): SqlResult {
  return {
    rows: value.rows.map((row) => ({ ...row })),
    rowsAffected: value.rowsAffected,
  };
}

function argumentsFor(values: readonly unknown[]): InValue[] {
  return values.map((value) => {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "bigint" ||
      value instanceof ArrayBuffer ||
      value instanceof Uint8Array
    )
      return value;
    if (typeof value === "boolean") return value ? 1 : 0;
    throw new TypeError(`unsupported Turso argument type: ${typeof value}`);
  });
}

class TursoTransaction implements AsyncSqlTransaction {
  public constructor(private readonly transaction: Transaction) {}

  public async execute(
    sql: string,
    args: readonly unknown[] = [],
  ): Promise<SqlResult> {
    return result(
      await this.transaction.execute({ sql, args: argumentsFor(args) }),
    );
  }

  public async commit(): Promise<void> {
    await this.transaction.commit();
  }

  public async rollback(): Promise<void> {
    await this.transaction.rollback();
  }
}

export class TursoSqlClient implements AsyncSqlClient {
  public constructor(private readonly client: Client) {}

  public static fromEnvironment(
    environment: NodeJS.ProcessEnv = process.env,
  ): TursoSqlClient {
    const url = environment.TURSO_DATABASE_URL;
    const authToken = environment.TURSO_AUTH_TOKEN;
    if (!url) throw new Error("TURSO_DATABASE_URL is required");
    if (!url.startsWith("file:") && !authToken)
      throw new Error("TURSO_AUTH_TOKEN is required for a remote database");
    return new TursoSqlClient(
      createClient({ url, ...(authToken ? { authToken } : {}) }),
    );
  }

  public async execute(
    sql: string,
    args: readonly unknown[] = [],
  ): Promise<SqlResult> {
    return result(await this.client.execute({ sql, args: argumentsFor(args) }));
  }

  public async transaction(mode: "write"): Promise<AsyncSqlTransaction> {
    return new TursoTransaction(await this.client.transaction(mode));
  }

  public close(): void {
    this.client.close();
  }
}
