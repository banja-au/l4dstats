import { useI18n } from "./i18n";
import type { CSSProperties } from "react";

export function EvidencePulse({ label }: { label?: string }) {
  return (
    <span className="evidence-pulse" aria-hidden="true">
      <i />
      <i />
      <i />
      {label && <span>{label}</span>}
    </span>
  );
}

export default function EvidenceLoader({ label }: { label?: string }) {
  const { tx } = useI18n();
  const resolvedLabel =
    label ?? tx("Reconstructing evidence", "Reconstruyendo evidencia");
  return (
    <main
      className="evidence-loader"
      aria-live="polite"
      aria-label={resolvedLabel}
    >
      <div className="evidence-loader-noise" />
      <div className="evidence-loader-lockup">
        <div className="evidence-loader-radar" aria-hidden="true">
          <i className="evidence-loader-sweep" />
          <i className="evidence-loader-blip evidence-loader-blip-one" />
          <i className="evidence-loader-blip evidence-loader-blip-two" />
          <img src="/art/infected-mark.webp" alt="" />
        </div>
        <div className="evidence-loader-copy">
          <span>{tx("Signal acquired", "Señal adquirida")}</span>
          <strong>{resolvedLabel}</strong>
          <div className="evidence-loader-wave" aria-hidden="true">
            {Array.from({ length: 28 }, (_, index) => (
              <i key={index} style={{ "--bar": index } as CSSProperties} />
            ))}
          </div>
          <small>
            {tx(
              "Hold tight · following the evidence chain",
              "Espera · siguiendo la cadena de evidencia",
            )}
          </small>
        </div>
      </div>
    </main>
  );
}
