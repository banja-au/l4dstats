export type AcquisitionErrorCode =
  | "ABORTED"
  | "ALLOWLIST"
  | "DOWNLOAD_LIMIT"
  | "HTTP"
  | "INVALID_ARCHIVE"
  | "REDIRECT_LIMIT"
  | "TIMEOUT"
  | "ZIP_LIMIT";

export class AcquisitionError extends Error {
  constructor(
    readonly code: AcquisitionErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AcquisitionError";
  }
}
