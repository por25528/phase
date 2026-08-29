import { Fragment } from 'react';
import { DOWNLOAD_NOTE, DOWNLOAD_URL } from './download';
import { delay, useReveal } from './reveal';

/* The page is one ruled sheet, the same argument Today makes in the app:
   a bounded reading column, hairlines for edges, hatch for the margin.
   Every heading is a rule with the label set INTO it — the app's RuleHeader
   restated for a page that scrolls.

   Motion is SURGICAL: three curves, one rise distance, one lift, one stagger.
   Phase forecasts nothing and overshoots nothing; a bouncing spring would be
   the page arguing with the product. See the MOTION block in index.css. */

/** A section rule: mono tag in a tinted cell at the left end, fact at the far
 *  end. The hairline is a real element rather than a border so it can be drawn
 *  from the left edge as the section arrives. */
function Rule({ tag, fact }: { tag: string; fact?: string }) {
  return (
    <div className="relative flex items-center pt-px" data-reveal="rule">
      <span aria-hidden className="rule-line absolute top-0 inset-x-0 h-px bg-line" />
      <span className="rule-cell section-label bg-chip text-ink font-semibold px-3 py-1.5 border-x border-b border-line -mt-px">
        {tag}
      </span>
      <span className="flex-1" />
      {fact && (
        <span className="rule-cell rule-cell-2 section-label text-muted px-3 py-1.5 border-x border-b border-line -mt-px">
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

/** A plain U+0020, written as a constant so no editor or pipe can quietly
 *  turn it into a non-breaking space and stop the masthead wrapping. */
const SPACE = String.fromCharCode(32);

/** The masthead, set word by word. Each word rises into its own slot, so the
 *  line reads as type being set rather than letters being assembled. Exactly
 *  one heading on the page does this; the rest simply arrive. */
function SplitHeading({ text, className, style }: { text: string; className?: string; style?: React.CSSProperties }) {
  const words = text.split(' ');
  return (
    <h1 aria-label={text} className={className} style={style} data-reveal="words" data-enter>
      {words.map((word, i) => (
        // The space lives OUTSIDE the mask. A trailing space inside an
        // overflow-hidden inline-block collapses away, and a non-breaking
        // space would stop the masthead wrapping inside its 14ch measure.
        <Fragment key={`${word}-${i}`}>
          <span aria-hidden className="w-mask" style={delay(110 + i * 60)}>
            <span className="w-inner">{word}</span>
          </span>
          {i < words.length - 1 ? SPACE : null}
        </Fragment>
      ))}
    </h1>
  );
}

/** A screenshot in a hairline frame. Light and dark are different captures.
 *  The frame is focusable so keyboard users get the same lift the cursor does. */
function Shot({ name, alt, eager, d = 0, enter }: {
  name: string; alt: string; eager?: boolean; d?: number; enter?: boolean;
}) {
  return (
    <div className="shot-frame" data-reveal="shot" data-enter={enter ? '' : undefined} style={delay(d)}>
      <picture>
        <source srcSet={`/shots/${name}-dark.png`} media="(prefers-color-scheme: dark)" />
        <img
          src={`/shots/${name}-light.png`}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          className="w-full rounded-[6px] border border-line-2 shadow-shot"
        />
      </picture>
    </div>
  );
}

/** Signature 3: the shredder. One goal sheet feeds an ink slot and hangs
 *  below it as strips — each strip a piece of work small enough to be a day.
 *  The figure is one reveal group: the sheet descends, then the strips drop
 *  with the page's own stagger. Blank strips keep the rhythm honest; a
 *  shredder does not label every cut. */
const STRIPS: [string, number][] = [
  ['wireframe · 2h', 150],
  ['copy draft · 90m', 196],
  ['', 122],
  ['build hero · 3h', 208],
  ['polish nav · 1h', 168],
  ['', 134],
  ['deploy · 30m', 184],
];

function Shredder() {
  return (
    <div className="max-w-[440px] mx-auto" data-reveal="shred">
      {/* The window clips the sheet's lower edge, so at rest the goal is
          already part-swallowed — the no-JS state is the finished figure. */}
      <div className="overflow-hidden">
        <div className="shred-sheet w-[300px] max-w-full mx-auto -mb-7 bg-panel border border-line-2 rounded-t-[6px] shadow-card px-6 pt-5 pb-12 text-left">
          <span className="section-label text-chip-ink">goal</span>
          <div className="font-disp font-semibold text-ink mt-2" style={{ fontSize: '1.35rem', lineHeight: 1.15 }}>
            Ship the portfolio site.
          </div>
          <div className="font-mono text-micro tracking-[.11em] uppercase text-muted mt-3">
            est 42h · horizon: now
          </div>
        </div>
      </div>
      {/* The machine is the app: an ink bar with the nameplate set in it. */}
      <div className="relative z-10 h-3.5 bg-ink rounded-[2px] flex items-center justify-end px-2.5">
        <span aria-hidden className="font-mono text-[9px] leading-none tracking-[.2em] uppercase text-bg/60">
          phase
        </span>
      </div>
      <div className="overflow-hidden flex justify-center items-start gap-1.5" style={{ height: 220 }}>
        {STRIPS.map(([label, h], i) => (
          <div
            key={i}
            className="shred-strip w-7 bg-panel border border-t-0 border-line-2 shadow-card pt-3 flex justify-center"
            style={{ height: h, ...delay(340 + i * 70) }}
          >
            {label && <span className="shred-label section-label text-muted">{label}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function DownloadButton({ large }: { large?: boolean }) {
  return (
    <a
      href={DOWNLOAD_URL}
      className={`act inline-flex items-center justify-center rounded-field bg-ink text-bg font-medium
        hover:shadow-shot
        ${large ? 'px-8 py-3.5 text-lead' : 'px-5 py-2.5 text-body'}`}
    >
      Download for macOS
    </a>
  );
}

export function App() {
  useReveal();

  return (
    <div className="min-h-screen hatch">
      {/* The sheet: a bounded column; everything outside it is margin, and the margin is material. */}
      <div className="mx-auto max-w-[1120px] border-x border-line bg-bg">

        {/* ── Nav ───────────────────────────────────────────────── */}
        <header
          className="flex items-center justify-between px-6 sm:px-10 py-5 border-b border-line"
          data-reveal="down"
          data-enter
        >
          <span className="wordmark font-disp text-wordmark font-semibold">
            Phase<span className="wordmark-dot">.</span>
          </span>
          <a
            href={DOWNLOAD_URL}
            className="act text-body text-ink-soft border border-line-2 rounded-field px-4 py-1.5
              hover:bg-ink hover:text-bg hover:border-ink"
          >
            Download
          </a>
        </header>

        {/* ── Hero ──────────────────────────────────────────────────
            The opening sequence spends 300ms of stagger and lands inside
            800ms. Order is hierarchy, not DOM: stamp, masthead, claim, act. */}
        <section className="px-6 sm:px-10 pt-16 sm:pt-24 pb-16">
          <div data-reveal="up" data-enter style={delay(60)}>
            <Stamp head="macOS" rest="local-first planner" />
          </div>
          <SplitHeading
            text="The honest planner."
            className="font-disp font-semibold text-ink mt-8 max-w-[14ch]"
            style={{ fontSize: 'clamp(3rem, 8vw, 6.75rem)', lineHeight: 0.98, letterSpacing: '-0.02em' }}
          />
          <p
            className="text-lead sm:text-h2 text-muted mt-8 max-w-[46ch] leading-relaxed"
            data-reveal="up"
            data-enter
            style={delay(230)}
          >
            Phase turns goals into weeks and weeks into days, states what it
            measures, and forecasts nothing. On your Mac, in your hands.
          </p>
          <div
            className="mt-10 flex items-center gap-5"
            data-reveal="up"
            data-enter
            style={delay(300)}
          >
            <DownloadButton large />
            <span className="font-mono text-micro tracking-[.11em] uppercase text-muted">{DOWNLOAD_NOTE}</span>
          </div>
        </section>

        {/* The product, at rest: one day, framed. */}
        <section className="px-6 sm:px-10 pb-24">
          {/* The last beat of the opening sequence. It sits below the fold's
              text but still intersects at load, so without an explicit delay
              the product shot arrives before the headline that introduces it. */}
          <Shot
            name="today"
            alt="Phase's Today view: a framed reading column with the day's queue, a free-time offer, carried-over work and what was finished"
            eager
            enter
            d={370}
          />
        </section>

        {/* ── Method — the shredder ─────────────────────────────────
            The figure sits where the claim is first made: a big goal
            goes into the slot and comes out as days. */}
        <section>
          <Rule tag="Method" fact="goals in, days out" />
          <div className="px-6 sm:px-10 pt-16 sm:pt-20 pb-12 sm:pb-16">
            <Shredder />
          </div>
        </section>

        {/* ── Plan ──────────────────────────────────────────────── */}
        <section>
          <Rule tag="Plan" fact="the week is the unit" />
          <div className="px-6 sm:px-10 py-16 sm:py-20 grid grid-cols-1 lg:grid-cols-[1fr_1.6fr] gap-10 lg:gap-14 items-center">
            <div>
              <h2
                className="font-disp font-semibold text-ink"
                style={{ fontSize: 'clamp(1.6rem, 2.6vw, 2.3rem)', lineHeight: 1.1 }}
                data-reveal="up"
              >
                Drag the week into shape.
              </h2>
              <p className="text-body sm:text-lead text-muted mt-5 leading-relaxed" data-reveal="up" style={delay(70)}>
                The backlog rail holds what each project needs next; the grid
                holds the hours. Drop a task on a day and it becomes a sitting
                with a real start and a real length. Work you have committed
                but not placed stays its own number — the header never folds
                the two into one comfortable figure.
              </p>
              <p className="text-body sm:text-lead text-muted mt-4 leading-relaxed" data-reveal="up" style={delay(140)}>
                When a sitting slips past, Phase proposes a replan and shows
                you every move before anything is written.
              </p>
            </div>
            <Shot
              name="plan"
              alt="Phase's Plan view: a backlog rail beside a week calendar with placed work blocks"
              d={70}
            />
          </div>
        </section>

        {/* ── Goals ─────────────────────────────────────────────── */}
        <section>
          <Rule tag="Goals" fact="four horizons" />
          <div className="px-6 sm:px-10 py-16 sm:py-20 grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-10 lg:gap-14 items-center">
            <div className="order-1 lg:order-none">
              <Shot name="goals" alt="Phase's Goals board: Now, Next, Later and Someday columns on a ruled sheet" d={70} />
            </div>
            <div className="-order-1 lg:order-none">
              <h2
                className="font-disp font-semibold text-ink"
                style={{ fontSize: 'clamp(1.6rem, 2.6vw, 2.3rem)', lineHeight: 1.1 }}
                data-reveal="up"
              >
                Now, Next, Later, Someday.
              </h2>
              <p className="text-body sm:text-lead text-muted mt-5 leading-relaxed" data-reveal="up" style={delay(70)}>
                Every goal sits on one of four horizons, and Now has a drawn
                limit — a gauge with a fixed number of cells, because a
                commitment you can see is one you can keep.
              </p>
              <p className="text-body sm:text-lead text-muted mt-4 leading-relaxed" data-reveal="up" style={delay(140)}>
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
              <div
                key={tag}
                className={`tenet px-6 sm:px-8 py-10 ${i > 0 ? 'sm:border-l border-t sm:border-t-0 border-line' : ''}`}
                data-reveal="up"
                style={delay(i * 70)}
              >
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
              <h2
                className="font-disp font-semibold text-ink"
                style={{ fontSize: 'clamp(1.6rem, 2.6vw, 2.3rem)', lineHeight: 1.1 }}
                data-reveal="up"
              >
                Your plans never leave your Mac.
              </h2>
              <p className="text-body sm:text-lead text-muted mt-5 leading-relaxed" data-reveal="up" style={delay(70)}>
                Everything lives in a database on your machine. There is no
                account to make, no server to trust, and nothing phoning home.
                Your backup is one JSON file you can read, keep, and carry
                anywhere.
              </p>
            </div>
            {/* A spec sheet, in the app's own ledger voice. Rows arrive one
                after another so the sheet reads as it is being filled in. */}
            <dl className="border border-line-2 rounded-[6px] bg-panel shadow-card divide-y divide-line overflow-hidden">
              {([
                ['storage', 'IndexedDB, on this device'],
                ['account', 'none'],
                ['sync', 'none — one machine, one writer'],
                ['backup', 'one JSON file, export & import'],
                ['telemetry', 'none'],
              ] as [string, string][]).map(([k, v], i) => (
                <div
                  key={k}
                  className="ledger-row flex items-baseline justify-between gap-6 px-5 py-3.5"
                  data-reveal="up"
                  style={delay(i * 70)}
                >
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
              data-reveal="up"
            >
              Plan less. Finish more.
            </h2>
            <div className="mt-10 flex flex-col items-center gap-4" data-reveal="up" style={delay(70)}>
              <DownloadButton large />
              <span className="font-mono text-micro tracking-[.11em] uppercase text-muted">{DOWNLOAD_NOTE}</span>
            </div>
          </div>
        </section>

        {/* ── Footer ────────────────────────────────────────────── */}
        <footer className="relative border-t border-transparent px-6 sm:px-10 py-8 flex flex-col sm:flex-row items-center justify-between gap-4" data-reveal="rule">
          <span aria-hidden className="rule-line absolute -top-px inset-x-0 h-px bg-line" />
          <span className="rule-cell wordmark font-disp text-title font-semibold">
            Phase<span className="wordmark-dot">.</span>
          </span>
          <span className="rule-cell rule-cell-2 font-mono text-micro tracking-[.11em] uppercase text-faint">
            local-first · built with react &amp; electron
          </span>
        </footer>
      </div>

      {/* The tail below the sheet stays hatched, like the page ran on. */}
      <div className="h-16" />
    </div>
  );
}
