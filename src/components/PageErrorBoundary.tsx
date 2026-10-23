import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { resetKey: string; children: ReactNode };
type State = { failed: boolean; key: string };

/**
 * What a page shows when it cannot be shown: its chunk failed to arrive twice
 * (see chunkRecovery), or its module threw while it was being run.
 *
 * Under the header, like the Suspense fallback it sits around, so the header
 * and its tabs stay up and the rest of the game stays one tap away. Without it
 * React would unmount the whole tree and leave a blank page. `resetKey` is the
 * route: moving to another page tries again from scratch.
 */
export class PageErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey === state.key ? null : { failed: false, key: props.resetKey };
  }

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Page failed to render", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="app__page-loading" role="alert">
        <p>Couldn't load this page.</p>
        <button type="button" className="share-button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
