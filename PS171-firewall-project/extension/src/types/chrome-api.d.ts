declare const chrome: {
  runtime: {
    id?: string;
    sendMessage(message: unknown): Promise<unknown>;
    openOptionsPage(): void;
    onMessage: {
      addListener(
        listener: (
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void
        ) => boolean | void
      ): void;
    };
  };
  tabs: {
    query(queryInfo: {
      active?: boolean;
      currentWindow?: boolean;
    }): Promise<Array<{ id?: number; url?: string; title?: string }>>;
    sendMessage(tabId: number, message: unknown): Promise<unknown>;
    captureVisibleTab(
      windowId?: number | null,
      options?: { format?: "jpeg" | "png"; quality?: number }
    ): Promise<string>;
  };
  storage: {
    local: {
      get(keys?: string | string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    };
    onChanged: {
      addListener(
        listener: (
          changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
          area: "local" | "sync" | "session" | "managed"
        ) => void
      ): void;
    };
  };
};
declare const browser: { runtime: typeof chrome.runtime } | undefined;
