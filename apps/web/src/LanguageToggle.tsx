import { captureAnalyticsEvent } from "./analytics";
import { useI18n } from "./i18n";

const languageCodes = { en: "EN", es: "ES" } as const;

export function LanguageToggle() {
  const { locale, setLocale, t } = useI18n();
  const next = locale === "en" ? "es" : "en";
  return (
    <button
      className="language-toggle"
      type="button"
      title={t(`language.${next === "en" ? "english" : "spanish"}`)}
      onClick={() => {
        setLocale(next);
        captureAnalyticsEvent("language_changed", { locale: next });
      }}
    >
      <span className={locale === "en" ? "active" : undefined}>
        {languageCodes.en}
      </span>
      <span className="language-toggle-separator" aria-hidden="true">
        /
      </span>
      <span className={locale === "es" ? "active" : undefined}>
        {languageCodes.es}
      </span>
    </button>
  );
}
