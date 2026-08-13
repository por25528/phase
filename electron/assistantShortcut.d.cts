export interface ShortcutStatus {
  requested: string | null;
  active: string | null;
  registered: boolean;
  conflict: boolean;
}

export interface AssistantShortcutDeps {
  /** Wraps globalShortcut.register; returns false when the OS refuses the chord. */
  register(accelerator: string, handler: () => void): boolean;
  unregister(accelerator: string): void;
  onOpen(): void;
}

export interface AssistantShortcut {
  setAccelerator(requested: string): ShortcutStatus;
  dispose(): void;
  active(): string | null;
}

export declare function createAssistantShortcut(deps: AssistantShortcutDeps): AssistantShortcut;
