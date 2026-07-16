import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Activity, Crosshair, ShieldCheck } from "lucide-react";
import "./styles.css";

function App() {
  return (
    <main className="min-h-screen bg-[#080b0f] text-slate-100">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <header className="flex items-center gap-3 text-lime-300">
          <Crosshair size={28} />
          <span className="font-mono text-sm tracking-[0.28em]">
            WITCHWATCH
          </span>
        </header>
        <section className="grid gap-12 py-24 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="mb-5 font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
              Demo forensics · human reviewed
            </p>
            <h1 className="max-w-3xl text-5xl font-semibold leading-[1.05] tracking-tight md:text-7xl">
              Suspicion is a lead.
              <br />
              <span className="text-lime-300">Evidence is the product.</span>
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-400">
              A reproducible workbench for inspecting L4D2 demo telemetry,
              finding anomalous play, and reviewing the strongest benign
              explanation beside every signal.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 shadow-2xl shadow-lime-950/20">
            <div className="mb-8 flex items-center justify-between">
              <span className="text-sm text-slate-400">Analysis readiness</span>
              <Activity className="text-lime-300" size={20} />
            </div>
            <div className="space-y-5">
              {[
                "Parser fixture gate",
                "Explainable detectors",
                "Calibrated review priority",
              ].map((label, index) => (
                <div key={label}>
                  <div className="mb-2 flex justify-between text-sm">
                    <span>{label}</span>
                    <span className="font-mono text-slate-500">
                      0{index + 1}
                    </span>
                  </div>
                  <div className="h-1 rounded bg-white/10">
                    <div
                      className="h-1 rounded bg-lime-300"
                      style={{ width: `${88 - index * 19}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-10 flex gap-3 rounded-xl border border-amber-300/15 bg-amber-300/5 p-4 text-sm leading-6 text-amber-100/70">
              <ShieldCheck className="mt-0.5 shrink-0" size={18} />
              <span>
                No automated verdicts or bans. Scores remain versioned review
                aids with uncertainty.
              </span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
