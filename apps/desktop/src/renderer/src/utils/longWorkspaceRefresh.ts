export interface LongWorkspaceRefreshClock {
  begin(bookId: string): number;
  invalidate(bookId: string): void;
  isCurrent(bookId: string, requestId: number): boolean;
}

export function createLongWorkspaceRefreshClock(): LongWorkspaceRefreshClock {
  const clocks = new Map<string, number>();

  function advance(bookId: string): number {
    const next = (clocks.get(bookId) ?? 0) + 1;
    clocks.set(bookId, next);
    return next;
  }

  return {
    begin: advance,
    invalidate(bookId) {
      advance(bookId);
    },
    isCurrent(bookId, requestId) {
      return clocks.get(bookId) === requestId;
    }
  };
}
