import type { Job, WorkbenchRepository } from "@witchwatch/storage";

export type JobHandler = (
  job: Job,
  context: {
    progress(value: number, message: string): void;
    isCancelled(): boolean;
  },
) => Promise<void>;
export class LocalWorker {
  public constructor(
    private readonly repo: WorkbenchRepository,
    private readonly handler: JobHandler,
  ) {}
  public async runOnce(): Promise<boolean> {
    const job = this.repo.claimNext();
    if (!job) return false;
    const context = {
      progress: (value: number, message: string) =>
        this.repo.progress(job.id, value, message),
      isCancelled: () => this.repo.getJob(job.id)?.state === "cancelled",
    };
    try {
      await this.handler(job, context);
      if (!context.isCancelled()) this.repo.finish(job.id, "succeeded");
    } catch (error) {
      if (!context.isCancelled())
        this.repo.finish(
          job.id,
          "failed",
          error instanceof Error ? error.message : "worker failed",
        );
    }
    return true;
  }
}
