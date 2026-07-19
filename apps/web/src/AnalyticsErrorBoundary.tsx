import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureAnalyticsException } from "./analytics";

export class AnalyticsErrorBoundary extends Component<
  { children: ReactNode },
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
          <h1>L4DStats could not render this page</h1>
          <p>Reload the page to try again.</p>
        </main>
      );
    return this.props.children;
  }
}
