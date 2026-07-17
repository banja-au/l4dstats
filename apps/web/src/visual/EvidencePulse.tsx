import { useId } from "react";

type EvidencePulseProps = {
  className?: string;
  label?: string;
  compact?: boolean;
};

/** A looping evidence/ECG trace. Animation is disabled by reduced-motion. */
export function EvidencePulse({
  className,
  label = "Evidence activity",
  compact = false,
}: EvidencePulseProps) {
  const titleId = useId();
  const gradientId = useId();
  const maskId = useId();
  const trace =
    "M0 34h24l5-2 4 3 5-20 7 38 7-19 6 5 6-2h17l5-3 5 3 6-11 8 20 7-10 7 3h30";

  return (
    <svg
      className={["ww-pulse", compact && "ww-pulse--compact", className]
        .filter(Boolean)
        .join(" ")}
      viewBox="0 0 180 68"
      role="img"
      aria-labelledby={titleId}
      preserveAspectRatio="none"
    >
      <title id={titleId}>{label}</title>
      <defs>
        <linearGradient id={gradientId} x1="0" x2="1">
          <stop stopColor="currentColor" stopOpacity="0" />
          <stop offset=".18" stopColor="currentColor" stopOpacity=".45" />
          <stop offset=".62" stopColor="currentColor" />
          <stop offset="1" stopColor="currentColor" stopOpacity=".18" />
        </linearGradient>
        <mask id={maskId}>
          <rect
            className="ww-pulse__reveal"
            width="180"
            height="68"
            fill="white"
          />
        </mask>
      </defs>
      <g className="ww-pulse__grid">
        <path d="M0 17h180M0 34h180M0 51h180M30 0v68M60 0v68M90 0v68M120 0v68M150 0v68" />
      </g>
      <path className="ww-pulse__ghost" d={trace} />
      <path
        className="ww-pulse__trace"
        d={trace}
        stroke={`url(#${gradientId})`}
        mask={`url(#${maskId})`}
      />
      <circle className="ww-pulse__beacon" cx="136" cy="43" r="2.5" />
    </svg>
  );
}
