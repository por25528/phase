import { Component, type ReactNode } from 'react';
import { emergencyBackupText, downloadBackupText } from '../db/db';
import { todayStr } from '../lib/dates';

type Rescue = 'idle' | 'saving' | 'saved' | 'failed';

/**
 * The one surface that renders BECAUSE the app failed.
 *
 * Everything it offers therefore has to work from HERE, with the render tree
 * below it already gone. It used to say "export a backup from the sidebar",
 * which was wrong twice over: there is no sidebar with an export in it, and
 * the route it named would have gone through the store — the very thing that
 * just crashed. Naming a control that does not exist is worse than saying
 * nothing, because it sends someone looking while their data sits one press
 * away.
 *
 * So the recovery is on this screen and it reads the DATABASE.
 * `emergencyBackupText` goes straight to Dexie through the same loaders
 * hydration uses, owing nothing to the store, and produces exactly the file
 * Import accepts — the one derivation `buildBackupText` exists to keep single.
 *
 * The button reports what happened, in both directions. A fatal screen that
 * silently failed to save would leave someone reloading in the belief they
 * have a copy, and that is the one mistake this surface must not cause.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null; rescue: Rescue }
> {
  state = { error: null as Error | null, rescue: 'idle' as Rescue };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  private save = () => {
    // A second press while the first read is in flight would write two files
    // and race two status lines onto one button.
    if (this.state.rescue === 'saving') return;
    this.setState({ rescue: 'saving' });
    emergencyBackupText().then(
      (text) => {
        downloadBackupText(text, `phase-recovery-${todayStr()}.json`);
        this.setState({ rescue: 'saved' });
      },
      () => {
        this.setState({ rescue: 'failed' });
      },
    );
  };

  render() {
    if (!this.state.error) return this.props.children;
    const { rescue } = this.state;
    return (
      <div className="min-h-screen w-full grid place-items-center">
        <div className="border border-line rounded-[6px] bg-panel px-[26px] py-[22px] max-w-[420px]">
          <div className="text-h2 font-semibold mb-[6px]">Something broke.</div>
          <p className="text-body text-muted mb-[14px]">
            Nothing has been deleted — your work is still in this device’s database. Save a copy
            before reloading, in case the fault repeats.
          </p>
          <div className="flex items-center gap-[8px]">
            <button
              className="px-[12px] py-[5px] rounded-[6px] border border-line-2 text-body text-ink hover:bg-hover disabled:opacity-50"
              disabled={rescue === 'saving'}
              onClick={this.save}
            >
              {rescue === 'saving' ? 'Saving…' : 'Save a backup'}
            </button>
            <button
              className="px-[12px] py-[5px] rounded-[6px] border border-line-2 text-body text-ink hover:bg-hover"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
          {/*
            The outcome, in words, either way. `role="status"` rather than a
            toast: there is no store left to run one, and a message that
            vanished after 1.9 seconds is the mistake the persist banner was
            already fixed for.
          */}
          {rescue === 'saved' && (
            <p role="status" className="mt-[10px] text-meta text-muted">
              Saved to your downloads. Import it from Phase’s menu once it reopens.
            </p>
          )}
          {rescue === 'failed' && (
            <p role="alert" className="mt-[10px] text-meta text-warn">
              Couldn’t read the database. Reload, then try Export backup from Phase’s menu.
            </p>
          )}
        </div>
      </div>
    );
  }
}
