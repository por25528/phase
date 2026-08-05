// Google events -> BusyBlock[]. Pure: no I/O, no clock, no network.
//
// This is a main-process module rather than a src/lib one because the seam
// says `src/` never sees Google JSON. It is nonetheless fully unit-tested
// offline; see busyBlocks.test.ts. Its contract lives in busyBlocks.d.cts.

/**
 * True when an event must not consume any time.
 *
 * All-day events are deliberately NOT skipped: they are always cached, and
 * the `allDayBlocks` preference is applied at read time in capacity.ts, so
 * toggling it never requires a refetch.
 */
function shouldSkipEvent(event) {
  if (event.status === 'cancelled') return true;
  if (event.transparency === 'transparent') return true;
  const attendees = event.attendees || [];
  // `self` matters: without it, a colleague declining would delete the
  // meeting from YOUR capacity.
  return attendees.some((a) => a.self === true && a.responseStatus === 'declined');
}

module.exports = { shouldSkipEvent };
