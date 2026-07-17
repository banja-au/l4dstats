const motes = [
  [7, 14, 2, 0],
  [18, 76, 1, 3],
  [28, 35, 3, 5],
  [42, 88, 2, 1],
  [51, 21, 1, 6],
  [63, 62, 2, 4],
  [74, 12, 1, 2],
  [83, 46, 3, 7],
  [94, 82, 2, 3],
] as const;

/** Decorative atmospheric layer. Place inside a positioned, overflow-hidden parent. */
export function AmbientField() {
  return (
    <div className="ww-ambient" aria-hidden="true">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id="ww-ambient-falloff" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.11" />
            <stop offset="0.52" stopColor="currentColor" stopOpacity="0" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0.08" />
          </linearGradient>
          <pattern
            id="ww-scanlines"
            width="3"
            height="3"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M0 2.5h3"
              stroke="currentColor"
              strokeOpacity=".045"
              strokeWidth=".18"
            />
          </pattern>
        </defs>
        <rect width="100" height="100" fill="url(#ww-ambient-falloff)" />
        <rect width="100" height="100" fill="url(#ww-scanlines)" />
        <path
          className="ww-scratch"
          d="M13 102 39-2M69 102 88-2M1 77 24 58M71 22 101 6"
        />
        {motes.map(([x, y, radius, delay], index) => (
          <circle
            className="ww-mote"
            key={index}
            cx={x}
            cy={y}
            r={radius / 10}
            style={{ animationDelay: `${delay * -0.7}s` }}
          />
        ))}
      </svg>
    </div>
  );
}
