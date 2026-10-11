export interface ScopedRequestToken {
  generation: number;
  scope: string;
}

/** Synchronous single-flight and stale-scope guard for session creation. */
export class CodexScopedRequestGate {
  private generation = 0;
  private locked = false;

  begin(scope: string): ScopedRequestToken | undefined {
    if (this.locked) return undefined;
    this.locked = true;
    return { generation: this.generation, scope };
  }

  invalidate(): void {
    this.generation++;
    this.locked = false;
  }

  isCurrent(token: ScopedRequestToken, activeScope: string): boolean {
    return token.generation === this.generation && token.scope === activeScope;
  }

  finish(token: ScopedRequestToken): void {
    if (token.generation === this.generation) this.locked = false;
  }
}
