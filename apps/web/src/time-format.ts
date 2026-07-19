const whole = new Intl.NumberFormat("en");

export function formatElapsedTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "time unavailable";
  const milliseconds = Math.round(seconds * 1_000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const remainingSeconds = Math.floor((milliseconds % 60_000) / 1_000);
  const remainder = milliseconds % 1_000;
  const clock = `${hours ? `${hours}:${minutes.toString().padStart(2, "0")}` : minutes}:${remainingSeconds.toString().padStart(2, "0")}.${remainder.toString().padStart(3, "0")}`;
  return clock;
}

export function formatTickTime(
  tick: number,
  tickRate: number | null | undefined,
): string {
  if (!Number.isFinite(tickRate) || !tickRate || tickRate <= 0)
    return `tick ${whole.format(tick)}`;
  return formatElapsedTime(tick / tickRate);
}
