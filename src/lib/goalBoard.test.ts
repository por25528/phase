import { describe, expect, it } from 'vitest';
import type { Goal, GoalNode } from '../db/types';
import {
  BOARD_MIN_OPEN_TASKS,
  boardAreas,
  boardCards,
  boardIsUseful,
  goalBoard,
} from './goalBoard';

const leaf = (id: string, over: Partial<GoalNode> = {}): GoalNode => ({ id, title: id, ...over });

const GOAL: Goal = {
  id: 'g',
  title: 'Launch SaaS MVP',
  nodes: [
    { id: 'eng', title: 'Engineering', children: [
      leaf('auth', { status: 'doing' }),
      { id: 'api', title: 'API', children: [leaf('webhooks', { status: 'blocked' })] },
    ] },
    { id: 'gtm', title: 'Go-to-market', children: [leaf('launch-post')] },
    leaf('pick-name', { status: 'done' }),
  ],
};

describe('boardCards', () => {
  it('takes leaves only — a container is not a card', () => {
    expect(boardCards(GOAL).map((c) => c.node.id))
      .toEqual(['auth', 'webhooks', 'launch-post', 'pick-name']);
  });

  it('carries the containers above a card as its breadcrumb', () => {
    const webhooks = boardCards(GOAL).find((c) => c.node.id === 'webhooks')!;
    expect(webhooks.areaPath).toEqual(['Engineering', 'API']);
  });

  /**
   * The filter is by top-level area. A nested container is a breadcrumb, not a
   * second filter dimension — that is how a filter row becomes a tree.
   */
  it('files a deeply nested card under its OUTERMOST container', () => {
    const webhooks = boardCards(GOAL).find((c) => c.node.id === 'webhooks')!;
    expect(webhooks.areaId).toBe('eng');
  });

  it('leaves a root-level task in no area at all', () => {
    const loose = boardCards(GOAL).find((c) => c.node.id === 'pick-name')!;
    expect(loose).toMatchObject({ areaId: null, areaPath: [] });
  });
});

describe('goalBoard', () => {
  it('sorts every card into the column its stored status names', () => {
    const byStatus = Object.fromEntries(
      goalBoard(GOAL).map((c) => [c.status, c.cards.map((x) => x.node.id)]),
    );
    expect(byStatus).toEqual({
      todo: ['launch-post'],
      doing: ['auth'],
      blocked: ['webhooks'],
      done: ['pick-name'],
    });
  });

  it('narrows to one area without losing the column shape', () => {
    const columns = goalBoard(GOAL, 'eng');
    expect(columns.map((c) => c.status)).toEqual(['todo', 'doing', 'blocked', 'done']);
    expect(columns.flatMap((c) => c.cards).map((c) => c.node.id)).toEqual(['auth', 'webhooks']);
  });

  it('shows every card when no area is chosen', () => {
    expect(goalBoard(GOAL, null).flatMap((c) => c.cards)).toHaveLength(4);
  });
});

describe('boardAreas', () => {
  it('offers the top-level containers, and not the nested ones', () => {
    expect(boardAreas(GOAL)).toEqual([
      { id: 'eng', title: 'Engineering' },
      { id: 'gtm', title: 'Go-to-market' },
    ]);
  });
});

describe('boardIsUseful', () => {
  /**
   * Four columns holding one card each is more chrome than content, and the
   * tree already shows order — which is what small goals are organised by.
   */
  it('says no for a goal with too little open work to arrange', () => {
    expect(boardIsUseful(GOAL)).toBe(false);
  });

  it('says yes once there is enough open work for state to matter', () => {
    const big: Goal = {
      ...GOAL,
      nodes: Array.from({ length: BOARD_MIN_OPEN_TASKS }, (_, i) => leaf(`n${i}`)),
    };
    expect(boardIsUseful(big)).toBe(true);
  });

  it('counts open work only — a finished goal does not need a board', () => {
    const done: Goal = {
      ...GOAL,
      nodes: Array.from({ length: 20 }, (_, i) => leaf(`n${i}`, { status: 'done' })),
    };
    expect(boardIsUseful(done)).toBe(false);
  });
});
