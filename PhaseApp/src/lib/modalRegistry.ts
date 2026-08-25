export interface ModalRegistry {
  register: (id: string) => () => void;
  hasOpenModal: () => boolean;
  topmost: () => string | null;
  isTopmost: (id: string) => boolean;
}

export function createModalRegistry(): ModalRegistry {
  let nextToken = 0;
  const entries: { id: string; token: number }[] = [];

  return {
    register(id) {
      const token = nextToken++;
      entries.push({ id, token });
      let registered = true;
      return () => {
        if (!registered) return;
        registered = false;
        const index = entries.findIndex((entry) => entry.token === token);
        if (index >= 0) entries.splice(index, 1);
      };
    },
    hasOpenModal: () => entries.length > 0,
    topmost: () => entries.at(-1)?.id ?? null,
    isTopmost: (id) => entries.at(-1)?.id === id,
  };
}

export const modalRegistry = createModalRegistry();
