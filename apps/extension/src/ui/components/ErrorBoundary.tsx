import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './Button';

/** Top-level catch-all: a render error shows a short message and a way out instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode; onReload?: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="atl-crash">
        <p>Something went wrong. Reload the page.</p>
        <Button onClick={() => (this.props.onReload ?? (() => window.location.reload()))()}>Reload</Button>
      </div>
    );
  }
}
