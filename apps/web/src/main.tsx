import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AnalyticsErrorBoundary } from "./AnalyticsErrorBoundary";
import { initializeAnalytics } from "./analytics";
import "./styles.css";

initializeAnalytics();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AnalyticsErrorBoundary>
      <App />
    </AnalyticsErrorBoundary>
  </StrictMode>,
);
