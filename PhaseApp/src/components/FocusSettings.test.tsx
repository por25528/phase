// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FocusSettings } from './FocusSettings';

const storeMock = vi.hoisted(() => ({
  cycleConfig: { workMin: 25, breakMin: 5, longBreakMin: 15, longEvery: 4 },
  setCycleConfig: vi.fn(),
}));

vi.mock('../state/store', () => ({
  useAppStore: () => ({
    cycleConfig: storeMock.cycleConfig,
    actions: { setCycleConfig: storeMock.setCycleConfig },
  }),
}));

afterEach(() => {
  cleanup();
  storeMock.cycleConfig = { workMin: 25, breakMin: 5, longBreakMin: 15, longEvery: 4 };
  vi.clearAllMocks();
});

describe('FocusSettings', () => {
  it('states the four numbers a pomodoro is started with', () => {
    render(<FocusSettings />);
    expect(screen.getByLabelText('Work interval')).toHaveProperty('value', '25');
    expect(screen.getByLabelText('Short break')).toHaveProperty('value', '5');
    expect(screen.getByLabelText('Long break')).toHaveProperty('value', '15');
    expect(screen.getByLabelText('Long break every')).toHaveProperty('value', '4');
  });

  it('dispatches the whole config on a change, so one write is one dial', () => {
    render(<FocusSettings />);
    fireEvent.change(screen.getByLabelText('Work interval'), { target: { value: '50' } });
    expect(storeMock.setCycleConfig).toHaveBeenCalledWith({
      workMin: 50, breakMin: 5, longBreakMin: 15, longEvery: 4,
    });
  });

  /**
   * The clamp lives in the action, not in four steppers — so a row hand-edited
   * on disk and a number typed here meet the same ranges. What this field must
   * not do is invent a number of its own: an emptied box dispatches nothing
   * and waits, rather than snapping the dial to a minimum mid-keystroke.
   */
  it('dispatches nothing while the field is empty', () => {
    render(<FocusSettings />);
    fireEvent.change(screen.getByLabelText('Work interval'), { target: { value: '' } });
    expect(storeMock.setCycleConfig).not.toHaveBeenCalled();
  });

  it('says out loud that a running session keeps the lengths it started with', () => {
    render(<FocusSettings />);
    expect(screen.getByText(/keeps the lengths it started with/)).toBeTruthy();
  });
});
