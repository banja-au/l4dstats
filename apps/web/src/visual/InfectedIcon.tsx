export const INFECTED_CLASSES = [
  "Smoker",
  "Boomer",
  "Hunter",
  "Spitter",
  "Jockey",
  "Charger",
  "Tank",
  "Witch",
] as const;

export type InfectedClass = (typeof INFECTED_CLASSES)[number];

type InfectedIconProps = {
  infectedClass: string;
  className?: string;
  label?: string;
};

const normalizeClass = (value: string): InfectedClass | null =>
  INFECTED_CLASSES.find(
    (candidate) => candidate.toLowerCase() === value.trim().toLowerCase(),
  ) ?? null;

/** Realistic, front-facing infected portraits matching the grungy favicon. */
export function InfectedIcon({
  infectedClass,
  className,
  label,
}: InfectedIconProps) {
  const kind = normalizeClass(infectedClass);
  if (!kind) return null;

  return (
    <img
      className={["infected-icon", className].filter(Boolean).join(" ")}
      src={`/art/si/${kind.toLowerCase()}.png`}
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
      data-infected-class={kind}
      draggable={false}
      decoding="async"
    />
  );
}
