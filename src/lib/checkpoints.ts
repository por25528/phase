import type { Goal, GoalNode } from '../db/types';
import { addDays } from './dates';
import { uid } from './tree';

interface LegacyMarker {
  id: string;
  title: string;
  date: string;
}

type GoalWithLegacyMarkers = Goal & { milestones?: LegacyMarker[] };

export const CHECKPOINT_SOON_DAYS = 14; // separate constant, same value — tunable apart

export interface CheckpointMarker {
  id: string;
  title: string;
  date: string;
}

function walkLeaves(g: Goal, visit: (n: GoalNode) => void): void {
  function walk(nodes: GoalNode[]): void {
    for (const n of nodes) {
      if (n.children && n.children.length) walk(n.children);
      else visit(n);
    }
  }
  walk(g.nodes);
}

export function checkpointDates(g: Goal): string[] {
  const dates: string[] = [];
  walkLeaves(g, (node) => {
    if (node.checkpoint && node.deadline !== undefined) dates.push(node.deadline);
  });
  return dates;
}

export function checkpointMarkers(g: Goal): CheckpointMarker[] {
  const markers: CheckpointMarker[] = [];
  walkLeaves(g, (node) => {
    if (node.checkpoint && node.deadline !== undefined) {
      markers.push({ id: node.id, title: node.title, date: node.deadline });
    }
  });
  return markers;
}

export function checkpointWithin(g: Goal, days: number, today: string): boolean {
  const end = addDays(today, days);
  let found = false;
  walkLeaves(g, (node) => {
    if (
      !found
      && node.checkpoint
      && !node.done
      && node.deadline !== undefined
      && node.deadline >= today
      && node.deadline <= end
    ) {
      found = true;
    }
  });
  return found;
}

export function nextCheckpoint(g: Goal, today: string): { title: string; date: string } | null {
  const candidates: GoalNode[] = [];
  walkLeaves(g, (node) => {
    if (node.checkpoint && !node.done && node.deadline !== undefined && node.deadline >= today) {
      candidates.push(node);
    }
  });
  candidates.sort((a, b) => a.deadline!.localeCompare(b.deadline!));
  const next = candidates[0];
  return next ? { title: next.title, date: next.deadline! } : null;
}

export function milestonesToCheckpointNodes(g: Goal): GoalNode[] {
  const legacy = g as GoalWithLegacyMarkers;
  const usedIds = new Set<string>();
  function collectIds(nodes: GoalNode[]): void {
    for (const node of nodes) {
      usedIds.add(node.id);
      if (node.children) collectIds(node.children);
    }
  }
  collectIds(g.nodes);

  return [...(legacy.milestones ?? [])]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((m) => {
      let id = m.id;
      while (usedIds.has(id)) id = uid();
      usedIds.add(id);
      return {
        id,
        title: m.title,
        checkpoint: true,
        done: false,
        start: m.date,
        deadline: m.date,
      };
    });
}
