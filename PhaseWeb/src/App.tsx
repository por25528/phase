import { DOWNLOAD_NOTE, DOWNLOAD_URL } from './download';

/* The page is one ruled sheet, the same argument Today makes in the app:
   a bounded reading column, hairlines for edges, hatch for the margin.
   Every heading is a rule with the label set INTO it — the app's RuleHeader
   restated for a page that scrolls. */

/** A section rule: mono tag in a tinted cell at the left end, fact at the far end. */
function Rule({ tag, fact }: { tag: string; fact?: string }) {
  return (
    <div className="flex items-center border-t border-line">
      <span className="section-label bg-chip text-ink font-semibold px-3 py-1.5 border-x border-b border-line -mt-px">
        {tag}
      </span>
      <span className="flex-1" />
      {fact && (
        <span className="section-label text-muted px-3 py-1.5 border-x border-b border-line -mt-px">
          {fact}
        </span>
      )}
    </div>
  );
}

/** The two-cell stamp Today wears — an inverted cell against a plain one. */
function Stamp({ head, rest }: { head: string; rest: string }) {
  return (
    <span className="inline-flex items-stretch border border-line-2 font-mono text-micro tracking-[.11em] uppercase">
      <span className="bg-ink text-bg px-2 py-1">{head}</span>
      <span className="px-2 py-1 text-muted">{rest}</span>
    </span>
  );
}

/** A screenshot in a hairline frame. Light and dark are different captures. */
function Shot({ name, alt, eager }: { name: string; alt: string; eager?: boolean }) {
  return (
    <picture>
      <source srcSet={`/shots/${name}-dark.png`} media="(prefers-color-scheme: dark)" />
      <img
        src={`/shots/${name}-light.png`}
        alt={alt}
        loading={eager ? 'eager' : 'lazy'}
        className="w-full rounded-[6px] border border-line-2 shadow-shot"
      />
    </picture>
  );
}

function DownloadButton({ large }: { large?: boolean }) {
  return (
    <a
      href={DOWNLOAD_URL}
      className={`inline-flex items-center justify-center rounded-field bg-ink text-bg font-medium
        transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
        hover:-translate-y-0.5 hover:shadow-card active:translate-y-0
        ${large ? 'px-8 py-3.5 text-lead' : 'px-5 py-2.5 text-body'}`}
    >
      Download for macOS
    </a>
  );
}

export function App() {
  return (
    <div className="min-h-screen hatch">
      {/* The sheet: a bounded column; everything outside it is margin, and the margin is material. */}
      <div className="mx-auto max-w-[1120px] border-x border-line bg-bg">

        {/* ── Nav ───────────────────────────────────────────────── */}
        <header className="flex items-center justify-between px-6 sm:px-10 py-5 border-b border-line">
          <span className="font-disp text-wordmark font-semibold">Phase.</span>
          <a
            href={DOWNLOAD_URL}
            className="text-body text-ink-soft hover:text-ink border border-line-2 rounded-field px-4 py-1.5 transition-colors"
          >
            Download
          </a>
        </header>

        {/* ── Hero ──────────────────────────────────────────────── */}
        <section className="px-6 sm:px-10 pt-16 sm:pt-24 pb-16">
          <div className="reveal">
            <Stamp head="macOS" rest="local-first planner" />
          </div>
          <h1
            className="reveal reveal-2 font-disp font-semibold text-ink mt-8 max-w-[14ch]"
            style={{ fontSize: 'clamp(3rem, 8vw, 6.75rem)', lineHeight: 0.98, letterSpacing: '-0.02em' }}
          >
            The honest planner.
          </h1>
          <p className="reveal reveal-3 text-lead sm:text-h2 text-muted mt-8 max-w-[46ch] leading-relaxed">
            Phase turns goals into weeks and weeks into days, states what it
            measures, and forecasts nothing. On your Mac, in your hands.
          </p>
          <div className="reveal reveal-4 mt-10 flex items-center gap-5">
            <DownloadButton large />
            <span className="font-mono text-micro tracking-[.11em] uppercase text-muted">{DOWNLOAD_NOTE}</span>
          </div>
        </section>

        {/* The product, at rest: one day, framed. */}
        <section className="px-6 sm:px-10 pb-24">
          <div className="reveal reveal-4">
            <Shot name="today" alt="Phase's Today view: a framed reading column with the day's queue, a free-time offer, carried-over work and what was finished" eager />
          </div>
        </section>

        {/* ── Plan ──────────────────────────────────────────────── */}
        <section>
          <Rule tag="Plan" fact="the week is the unit" />
          <div className="px-6 sm:px-10 py-16 sm:py-20 grid grid-cols-1 lg:grid-cols-[1fr_1.6fr] gap-10 lg:gap-14 items-center">
            <div>
              <h2 className="font-disp font-semibold text-ink" style={{ fontSize: 'clamp(1.6rem, 2.6vw, 2.3rem)', lineHeight: 1.1 }}>
                Drag the week into shape.
              </h2>
              <p className="text-body sm:text-lead text-muted mt-5 leading-relaxed">
                The backlog rail holds what each project needs next; the grid
                holds the hours. Drop a task on a day and it becomes a sitting
                with a real start and a real length. Work you have committed
                but not placed stays its own number — the header never folds
                the two into one comfortable figure.
              </p>
              <p className="text-body sm:text-lead text-muted mt-4 leading-relaxed">
                When a sitting slips past, Phase proposes a replan and shows
                you every move before anything is written.
              </p>
            </div>
            <Shot name="plan" alt="Phase's Plan view: a backlog rail beside a week calendar with placed work blocks" />
          </div>
        </section>

        {/* ── Goals ─────────────────────────────────────────────── */}
        <section>
          <Rule tag="Goals" fact="four horizons" />
          <div className="px-6 sm:px-10 py-16 sm:py-20 grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-10 lg:gap-14 items-center">
            <div className="order-1 lg:order-none">
              <Shot name="goals" alt="Phase's Goals board: Now, Next, Later and Someday columns on a ruled sheet" />
            </div>
            <div className="-order-1 lg:order-none">
              <h2 className="font-disp font-semibold text-ink" style={{ fontSize: 'clamp(1.6rem, 2.6vw, 2.3rem)', lineHeight: 1.1 }}>
                Now, Next, Later, Someday.
              </h2>
              <p className="text-body sm:text-lead text-muted mt-5 leading-relaxed">
                Every goal sits on one of four horizons, and Now has a drawn
                limit — a gauge with a fixed number of cells, because a
                commitment you can see is one you can keep.
              </p>
              <p className="text-body sm:text-lead text-muted mt-4 leading-relaxed">
                A goal's percentage moves only when you tick a box. Started
                work is a state, not a share — the bar never gives half
                credit, so it never has to take it back.
              </p>
            </div>
          </div>
        </section>

        {/* ── Principles — a ledger strip, not a card grid ──────── */}
        <section>
          <Rule tag="Principles" fact="what the instrument refuses" />
          <div className="grid grid-cols-1 sm:grid-cols-3 border-b border-line">
            {([
              ['no forecasts', 'A deadline, a remaining effort, a measured rate. Phase reports what happened and what is left — it never guesses when you will finish.'],
              ['two numbers', 'Estimate and actual are both real, so "you planned 90m and it took 145m" is an answer, not a feeling. Numbers that get compared share one derivation.'],
              ['one gesture', 'Ticking the checkbox is the only thing that moves a number. Everything else — status, schedule, estimate — moves attention, never the score.'],
            ] as [string, string][]).map(([tag, body], i) => (
              <div key={tag} className={`px-6 sm:px-8 py-10 ${i > 0 ? 'sm:border-l border-t sm:border-t-0 border-line' : ''}`}>
                <div className="section-label text-chip-ink">{tag}</div>
                <p className="text-body text-ink-soft mt-4 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Local-first ───────────────────────────────────────── */}
        <section>
          <Rule tag="Local-first" fact="your machine, your file" />
          <div className="px-6 sm:px-10 py-16 sm:py-20 grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
            <div>
              <h2 className="font-disp font-semibold text-ink" style={{ fontSize: 'clamp(1.6rem, 2.6vw, 2.3rem)', lineHeight: 1.1 }}>
                Your plans never leave your Mac.
              </h2>
              <p className="text-body sm:text-lead text-muted mt-5 leading-relaxed">
                Everything lives in a database on your machine. There is no
                account to make, no server to trust, and nothing phoning home.
                Your backup is one JSON file you can read, keep, and carry
                anywhere.
              </p>
            </div>
            {/* A spec sheet, in the app's own ledger voice. */}
            <dl className="border border-line-2 rounded-[6px] bg-panel shadow-card divide-y divide-line">
              {([
                ['storage', 'IndexedDB, on this device'],
                ['account', 'none'],
                ['sync', 'none — one machine, one writer'],
                ['backup', 'one JSON file, export & import'],
                ['telemetry', 'none'],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-6 px-5 py-3.5">
                  <dt className="section-label text-chip-ink shrink-0">{k}</dt>
                  <dd className="font-mono text-meta text-ink-soft text-right">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ── Final CTA ─────────────────────────────────────────── */}
        <section>
          <Rule tag="Get Phase" />
          <div className="px-6 sm:px-10 py-20 sm:py-28 text-center">
            <h2
              className="font-disp font-semibold text-ink mx-auto max-w-[16ch]"
              style={{ fontSize: 'clamp(2.2rem, 5vw, 4rem)', lineHeight: 1.02, letterSpacing: '-0.015em' }}
            >
              Put your week on paper.
            </h2>
            <div className="mt-10 flex flex-col items-center gap-4">
              <DownloadButton large />
              <span className="font-mono text-micro tracking-[.11em] uppercase text-muted">{DOWNLOAD_NOTE}</span>
            </div>
          </div>
        </section>

        {/* ── Footer ────────────────────────────────────────────── */}
        <footer className="border-t border-line px-6 sm:px-10 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="font-disp text-title font-semibold">Phase.</span>
          <span className="font-mono text-micro tracking-[.11em] uppercase text-faint">
            local-first · built with react &amp; electron
          </span>
        </footer>
      </div>

      {/* The tail below the sheet stays hatched, like the page ran on. */}
      <div className="h-16" />
    </div>
  );
}
