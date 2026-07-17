import { useId } from "react";

type HazardEmblemProps = {
  className?: string;
  label?: string;
  pulse?: boolean;
};

/** Original quarantine/telemetry mark; not derived from game branding. */
export function HazardEmblem({
  className,
  label,
  pulse = false,
}: HazardEmblemProps) {
  const titleId = useId();

  return (
    <svg
      className={["ww-emblem", pulse && "ww-emblem--pulse", className]
        .filter(Boolean)
        .join(" ")}
      viewBox="0 0 64 64"
      role={label ? "img" : undefined}
      aria-hidden={label ? undefined : true}
      aria-labelledby={label ? titleId : undefined}
    >
      {label && <title id={titleId}>{label}</title>}
      <path className="ww-emblem__ring" d="M32 4 56.2 18v28L32 60 7.8 46V18Z" />
      <circle className="ww-emblem__core" cx="32" cy="32" r="7" />
      <path d="M32 25V11M38 29l12-7M38 36l12 7M26 36l-12 7M26 29l-12-7" />
      <path
        className="ww-emblem__ticks"
        d="m25 12 7 5 7-5M48 27l-8 4 8 5M39 51l-7-5-7 5M16 36l8-5-8-4"
      />
    </svg>
  );
}
