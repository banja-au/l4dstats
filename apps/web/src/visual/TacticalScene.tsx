import { useId } from "react";

type TacticalSceneProps = {
  className?: string;
  label?: string;
  active?: boolean;
};

/** Abstract tactical reconstruction, intentionally not a real L4D2 map. */
export function TacticalScene({
  className,
  label = "Abstract tactical reconstruction",
  active = true,
}: TacticalSceneProps) {
  const titleId = useId();
  const clipId = useId();
  const hatchId = useId();

  return (
    <svg
      className={["ww-tactical", className].filter(Boolean).join(" ")}
      viewBox="0 0 420 260"
      role="img"
      aria-labelledby={titleId}
    >
      <title id={titleId}>{label}</title>
      <defs>
        <clipPath id={clipId}>
          <rect x="1" y="1" width="418" height="258" rx="18" />
        </clipPath>
        <pattern
          id={hatchId}
          width="10"
          height="10"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(35)"
        >
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="10"
            stroke="currentColor"
            strokeOpacity=".08"
            strokeWidth="2"
          />
        </pattern>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect className="ww-tactical__ground" width="420" height="260" />
        <rect width="420" height="260" fill={`url(#${hatchId})`} />
        <g className="ww-tactical__structure">
          <path d="M-8 42h111v47h66V17h82v67h74V43h103M-8 212h82v-52h97v87M252 260v-71h63v-55h113" />
          <path d="M102 42v26M169 84h31M251 84v31M74 160h32M171 160v28M315 134h-31" />
        </g>
        <path
          className="ww-tactical__route"
          d="M50 190C87 184 104 137 150 142s66 4 91-31 71-33 119-12"
        />
        <path className="ww-tactical__fov" d="m151 142 87-42-26 67Z" />
        <g className="ww-tactical__survivor" transform="translate(151 142)">
          <circle r="10" />
          <path d="M0-17v8M-17 0h8M17 0H9M0 17V9" />
        </g>
        <g
          className={[
            "ww-tactical__signal",
            active && "ww-tactical__signal--active",
          ]
            .filter(Boolean)
            .join(" ")}
          transform="translate(238 118)"
        >
          <circle className="ww-tactical__signal-wave" r="18" />
          <circle r="7" />
          <path d="m-3-2 6 4m-6 0 6-4" />
        </g>
        <g className="ww-tactical__contacts">
          <circle cx="325" cy="90" r="5" />
          <circle cx="344" cy="109" r="4" />
          <circle cx="84" cy="123" r="4" />
        </g>
        <g className="ww-tactical__coordinates">
          <text x="18" y="25">
            FLOOR 02 / RECONSTRUCTION
          </text>
          <text x="320" y="240">
            TICK 148,220
          </text>
        </g>
      </g>
      <rect
        className="ww-tactical__frame"
        x="1"
        y="1"
        width="418"
        height="258"
        rx="18"
      />
    </svg>
  );
}
