import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureAnalyticsException } from "./analytics";
import { useI18n } from "./i18n";

export class AnalyticsErrorBoundary extends Component<
  { children: ReactNode; detail: string; title: string },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: true } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    captureAnalyticsException(error, {
      boundary: "application",
      componentStackAvailable: Boolean(info.componentStack),
    });
  }

  override render(): ReactNode {
    if (this.state.failed)
      return (
        <main className="shell">
          <h1>{this.props.title}</h1>
          <p>{this.props.detail}</p>
        </main>
      );
    return this.props.children;
  }
}

export function LocalizedAnalyticsErrorBoundary({
  children,
}: {
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <AnalyticsErrorBoundary
      title={t("error.renderTitle")}
      detail={t("error.renderDetail")}
    >
      {children}
    </AnalyticsErrorBoundary>
  );
}
