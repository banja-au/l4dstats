import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { LocalizedAnalyticsErrorBoundary } from "./AnalyticsErrorBoundary";
import { initializeAnalytics } from "./analytics";
import { I18nProvider } from "./i18n";
import { LanguageToggle } from "./LanguageToggle";
import "./styles.css";

initializeAnalytics();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <LanguageToggle />
      <LocalizedAnalyticsErrorBoundary>
        <App />
      </LocalizedAnalyticsErrorBoundary>
    </I18nProvider>
  </StrictMode>,
);
