/** View-only types derived from CasePresentationV1. No display data lives here. */
export type ReviewState =
  | "unreviewed"
  | "in-review"
  | "needs-context"
  | "resolved";

export type Evidence = {
  id: string;
  demoId: string | null;
  family: "aim" | "awareness" | "cadence";
  title: string;
  tick: number;
  time: string;
  window: string;
  contribution: number | null;
  quality: number | null;
  explanation: string;
  counterevidence: string;
  limitation: string;
};

export type CaseSummary = {
  id: string;
  alias: string;
  identity: string;
  priority: number | null;
  label: "ranked evidence" | "insufficient data" | "highly anomalous";
  demos: string[];
  encounters: number;
  independentFamilies: number;
  state: ReviewState;
  lastActivity: string;
  evidence: Evidence[];
};
