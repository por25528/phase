import { describe, it, expect } from 'vitest';
import type { Goal, GoalNode } from '../db/types';
import {
  CONFIDENCE_RANK, CONFIDENCE_WEIGHT, isConfidence, topicIds, isTopic, topicConfidence,
  confidenceRank, sortForReview, readiness, describeReadiness, applyConfidence, topicAgeLabel,
  ratedWhenLabel, topicIdsIn, insideTopicsArea,
} from './confidence';

const TODAY = '2026-09-03';

function leaf(over: Partial<GoalNode> & { id: string }): GoalNode {
  return { title: over.id, ...over };
}
function goal(nodes: GoalNode[]): Goal {
  return { id: 'g1', title: 'Algorithms', type: 'study', deadline: '2026-09-20', datesConfirmed: true, nodes };
}
/** Topics area with three topics, plus an ordinary Practice step beside it. */
function subject(): Goal {
  return goal([
    { id: 'area', title: 'Topics', topics: true, children: [
      leaf({ id: 'dp', title: 'Dynamic programming' }),
      leaf({ id: 'graphs', title: 'Graphs', confidence: 'shaky', confidenceAt: '2026-09-01' }),
      { id: 'sub', title: 'Sorting', children: [
        leaf({ id: 'merge', title: 'Merge sort', confidence: 'solid', confidenceAt: '2026-08-20' }),
      ] },
    ] },
    { id: 'practice', title: 'Practice', children: [leaf({ id: 'ps1', title: 'Problem set 1' })] },
  ]);
}

describe('vocabulary', () => {
  it('ranks and weights are monotone', () => {
    expect(CONFIDENCE_RANK.shaky).toBeLessThan(CONFIDENCE_RANK.okay);
    expect(CONFIDENCE_RANK.okay).toBeLessThan(CONFIDENCE_RANK.solid);
    expect(CONFIDENCE_WEIGHT.solid).toBe(1);
    expect(CONFIDENCE_WEIGHT.shaky).toBeCloseTo(1 / 3);
  });
  it('isConfidence admits the three words only', () => {
    expect(isConfidence('okay')).toBe(true);
    expect(isConfidence('done')).toBe(false);
    expect(isConfidence(undefined)).toBe(false);
  });
});

describe('topicIds / isTopic', () => {
  it('collects every leaf beneath a topics area, at any depth, and nothing else', () => {
    expect([...topicIds(subject())].sort()).toEqual(['dp', 'graphs', 'merge']);
    expect(isTopic(subject(), 'merge')).toBe(true);
    expect(isTopic(subject(), 'ps1')).toBe(false);
    expect(isTopic(subject(), 'area')).toBe(false); // the area itself is a container
  });
  it('an empty topics area (a leaf with the flag) is not a topic itself', () => {
    const g = goal([leaf({ id: 'area', title: 'Topics', topics: true })]);
    expect(topicIds(g).size).toBe(0);
  });
  it('a goal with no topics area has no topics', () => {
    expect(topicIds(goal([leaf({ id: 'a' })])).size).toBe(0);
  });
  it('topicIdsIn takes the ancestor flag the list cannot see', () => {
    const sub = subject().nodes[0].children![2].children!; // Sorting's children
    expect(topicIdsIn(sub, false).size).toBe(0);
    expect([...topicIdsIn(sub, true)]).toEqual(['merge']);
  });
  it('insideTopicsArea is true for the area, everything beneath it, and nothing else', () => {
    expect(insideTopicsArea(subject(), 'area')).toBe(true);
    expect(insideTopicsArea(subject(), 'sub')).toBe(true);
    expect(insideTopicsArea(subject(), 'merge')).toBe(true);
    expect(insideTopicsArea(subject(), 'practice')).toBe(false);
    expect(insideTopicsArea(subject(), 'nope')).toBe(false);
  });
});

describe('topicConfidence / confidenceRank', () => {
  it('reads the pair and treats unrated as null / rank 0', () => {
    expect(topicConfidence(leaf({ id: 'a' }))).toBeNull();
    expect(confidenceRank(leaf({ id: 'a' }))).toBe(0);
    expect(topicConfidence(leaf({ id: 'a', confidence: 'okay', confidenceAt: TODAY }))).toBe('okay');
    expect(confidenceRank(leaf({ id: 'a', confidence: 'solid', confidenceAt: TODAY }))).toBe(3);
  });
  it('half a rating reads as unrated', () => {
    expect(topicConfidence(leaf({ id: 'a', confidence: 'okay' }))).toBeNull();
    expect(topicConfidence(leaf({ id: 'a', confidenceAt: TODAY }))).toBeNull();
  });
});

describe('sortForReview', () => {
  it('unrated first, then shaky, okay, solid', () => {
    const t = [
      leaf({ id: 'solid', confidence: 'solid', confidenceAt: TODAY }),
      leaf({ id: 'okay', confidence: 'okay', confidenceAt: TODAY }),
      leaf({ id: 'none' }),
      leaf({ id: 'shaky', confidence: 'shaky', confidenceAt: TODAY }),
    ];
    expect(sortForReview(t).map((n) => n.id)).toEqual(['none', 'shaky', 'okay', 'solid']);
  });
  it('inside a tier the oldest rating comes first; ties keep tree order', () => {
    const t = [
      leaf({ id: 'newer', confidence: 'okay', confidenceAt: '2026-09-02' }),
      leaf({ id: 'older', confidence: 'okay', confidenceAt: '2026-08-20' }),
      leaf({ id: 'same-a', confidence: 'okay', confidenceAt: '2026-09-02' }),
    ];
    expect(sortForReview(t).map((n) => n.id)).toEqual(['older', 'newer', 'same-a']);
  });
  it('does not mutate its input', () => {
    const t = [leaf({ id: 'b', confidence: 'solid', confidenceAt: TODAY }), leaf({ id: 'a' })];
    sortForReview(t);
    expect(t.map((n) => n.id)).toEqual(['b', 'a']);
  });
});

describe('readiness / describeReadiness', () => {
  it('counts each tier over the goal\'s topics only', () => {
    expect(readiness(subject())).toEqual({ topics: 3, unrated: 1, shaky: 1, okay: 0, solid: 1 });
  });
  it('phrases the count', () => {
    expect(describeReadiness({ topics: 0, unrated: 0, shaky: 0, okay: 0, solid: 0 })).toBeNull();
    expect(describeReadiness({ topics: 8, unrated: 8, shaky: 0, okay: 0, solid: 0 })).toBe('8 topics, none rated yet');
    expect(describeReadiness({ topics: 8, unrated: 2, shaky: 1, okay: 2, solid: 3 })).toBe('3 of 8 topics solid');
    expect(describeReadiness({ topics: 8, unrated: 0, shaky: 0, okay: 0, solid: 8 })).toBe('All 8 topics solid');
    expect(describeReadiness({ topics: 1, unrated: 0, shaky: 0, okay: 0, solid: 1 })).toBe('All 1 topic solid');
  });
});

describe('applyConfidence', () => {
  it('writes both fields and clears both fields', () => {
    const rated = applyConfidence(leaf({ id: 'a' }), 'okay', TODAY);
    expect(rated).toEqual({ id: 'a', title: 'a', confidence: 'okay', confidenceAt: TODAY });
    const cleared = applyConfidence(rated, null, TODAY);
    expect(cleared).toEqual({ id: 'a', title: 'a' });
    expect('confidence' in cleared).toBe(false);
    expect('confidenceAt' in cleared).toBe(false);
  });
  it('returns a copy', () => {
    const n = leaf({ id: 'a' });
    applyConfidence(n, 'solid', TODAY);
    expect(n.confidence).toBeUndefined();
  });
});

describe('topicAgeLabel / ratedWhenLabel', () => {
  it('says when a topic was rated, or that it was not', () => {
    expect(topicAgeLabel(leaf({ id: 'a' }), TODAY)).toBe('not rated yet');
    expect(topicAgeLabel(leaf({ id: 'a', confidence: 'okay', confidenceAt: TODAY }), TODAY)).toBe('okay, rated today');
    expect(topicAgeLabel(leaf({ id: 'a', confidence: 'okay', confidenceAt: '2026-09-02' }), TODAY)).toBe('okay, rated yesterday');
    expect(topicAgeLabel(leaf({ id: 'a', confidence: 'solid', confidenceAt: '2026-08-31' }), TODAY)).toBe('solid, rated 3 days ago');
  });
  it('ratedWhenLabel is the same clause without the word, and null unrated', () => {
    expect(ratedWhenLabel(leaf({ id: 'a' }), TODAY)).toBeNull();
    expect(ratedWhenLabel(leaf({ id: 'a', confidence: 'okay', confidenceAt: TODAY }), TODAY)).toBe('today');
    expect(ratedWhenLabel(leaf({ id: 'a', confidence: 'solid', confidenceAt: '2026-08-31' }), TODAY)).toBe('3 days ago');
  });
});
