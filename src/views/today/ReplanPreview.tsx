import { Modal } from '../../components/Modal';
import { IconArrowRight } from '../../components/Icons';
import { fmtD } from '../../lib/dates';
import { fmtMinutes } from '../../lib/effort';
import { clockLabel } from '../../lib/clock';
import { proposalMinutes, type ReplanProposal } from '../../lib/replan';

/**
 * What a recovery would actually do, before it does any of it.
 *
 * This is one of the two places in Phase that gets a centred dialog, and it
 * earns it: the user is being asked to approve a batch of writes they cannot
 * see the consequences of from the surface behind. Every move states where it
 * came from and where it would go, and — the part that matters — the work that
 * will NOT fit is listed too. An item quietly dropped from a recovery flow is
 * the same work slipping again, one layer deeper.
 */
export function ReplanPreview({
  open,
  proposal,
  onApply,
  onCancel,
}: {
  open: boolean;
  proposal: ReplanProposal;
  onApply: () => void;
  onCancel: () => void;
}) {
  const total = proposalMinutes(proposal);
  const { moves, unplaceable } = proposal;

  return (
    <Modal open={open} onClose={onCancel} title="Replan what slipped">
      <p className="text-ui text-ink-soft mb-[12px]">
        {moves.length === 0
          ? 'None of it fits in the next two weeks.'
          : `${moves.length} task${moves.length === 1 ? '' : 's'} · ${fmtMinutes(total)} into the earliest free time.`}
      </p>

      {moves.length > 0 && (
        <ul className="border-t border-line max-h-[40vh] overflow-y-auto">
          {moves.map((m) => (
            <li key={`${m.kind}:${m.id}`} className="flex items-center gap-[8px] py-[7px] border-b border-line">
              <span className="flex-1 min-w-0">
                <span className="block truncate text-ui text-ink-soft">{m.title}</span>
                {m.goalTitle && (
                  <span className="block truncate text-meta text-muted">{m.goalTitle}</span>
                )}
              </span>
              <span className="flex-none text-meta text-muted tabular-nums line-through">{fmtD(m.from)}</span>
              <span className="flex-none text-faint inline-flex" aria-hidden="true">
                <IconArrowRight size={12} />
              </span>
              <span className="flex-none text-meta text-ink-soft tabular-nums w-[104px] text-right">
                {fmtD(m.to)} {clockLabel(m.startMin)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {unplaceable.length > 0 && (
        <div className="mt-[12px] px-[11px] py-[9px] rounded-card bg-warn-tint">
          <p className="text-ui text-warn font-semibold mb-[3px]">
            {unplaceable.length} won’t fit in the next two weeks
          </p>
          <p className="text-meta text-ink-soft leading-[1.5]">
            {unplaceable.map((u) => u.title).join(', ')} — shorten {unplaceable.length === 1 ? 'it' : 'them'},
            split {unplaceable.length === 1 ? 'it' : 'them'} up, or open more hours in Plan.
            {' '}Nothing here is being changed.
          </p>
        </div>
      )}

      <div className="flex items-center gap-[8px] mt-[16px]">
        <button
          type="button"
          onClick={onApply}
          disabled={moves.length === 0}
          className="px-[14px] py-[8px] rounded-field bg-ink text-paper text-body font-semibold hover:bg-ink-hover disabled:opacity-40 disabled:pointer-events-none"
        >
          Move {moves.length > 0 ? `${moves.length} task${moves.length === 1 ? '' : 's'}` : 'nothing'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-[12px] py-[8px] rounded-field text-body text-ink-soft hover:bg-hover"
        >
          Leave it where it is
        </button>
      </div>
    </Modal>
  );
}
