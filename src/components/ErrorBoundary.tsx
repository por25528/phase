import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen w-full grid place-items-center">
        <div className="border border-line rounded-[7px] bg-panel px-[26px] py-[22px] max-w-[420px]">
          <div className="font-disp text-[1.2rem] font-semibold mb-[6px]">Something broke.</div>
          <p className="text-[.86rem] text-muted mb-[14px]">
            Your data is safe in the browser database. Reload to continue; if it repeats, export a backup from the sidebar.
          </p>
          <button className="px-[12px] py-[5px] rounded-[6px] border border-line-2 text-[.82rem] text-ink hover:bg-hover"
            onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
