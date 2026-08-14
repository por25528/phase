import type { AgentRequest, AgentResponse } from './agentProtocol';

/**
 * The renderer-side wrapper around the agent preload — and the reason nothing
 * else touches `window.phaseAgent` directly. In a plain browser (Vite dev,
 * the test suite) the preload does not exist, so this returns an inert stub:
 * subscribing yields an honest unsubscribe, replying goes nowhere, and
 * `available` says which world this is. The sibling of assistantBridge.ts and
 * shellBridge.ts, with the same rule: the surface is a FIXED pair of verbs,
 * neither of which accepts a channel name.
 */

export interface AgentBridge {
  /** False in the plain browser: nothing ever fires and replies go nowhere. */
  available: boolean;
  /** Subscribe to requests that arrived over the socket. Returns unsubscribe. */
  onRequest(fn: (id: number, request: AgentRequest) => void): () => void;
  /** Answer exactly one request. */
  reply(id: number, response: AgentResponse): void;
}

interface AgentPreload {
  onRequest(fn: (id: number, request: AgentRequest) => void): () => void;
  reply(id: number, response: AgentResponse): void;
}

function preload(): AgentPreload | null {
  if (typeof window === 'undefined') return null;
  const found = (window as unknown as { phaseAgent?: AgentPreload }).phaseAgent;
  return found ?? null;
}

export function createAgentBridge(): AgentBridge {
  const api = preload();
  if (!api) {
    return {
      available: false,
      onRequest: () => () => {},
      reply: () => {},
    };
  }
  return {
    available: true,
    onRequest: (fn) => api.onRequest(fn),
    reply: (id, response) => api.reply(id, response),
  };
}
