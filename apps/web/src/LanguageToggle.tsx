import { Languages } from "lucide-react";
import { captureAnalyticsEvent } from "./analytics";
import { useI18n } from "./i18n";

export function LanguageToggle() {
  const { locale, setLocale, t } = useI18n();
  const next = locale === "en" ? "es" : "en";
  return (
    <button
      className="language-toggle"
      type="button"
      aria-label={`${t("language.label")}: ${t(`language.${next === "en" ? "english" : "spanish"}`)}`}
      title={t(`language.${next === "en" ? "english" : "spanish"}`)}
      onClick={() => {
        setLocale(next);
        captureAnalyticsEvent("language_changed", { locale: next });
      }}
    >
      <Languages aria-hidden="true" />
      <span>{locale.toUpperCase()}</span>
    </button>
  );
}
