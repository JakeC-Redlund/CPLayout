export type AccountBoundaryResult = "preserved" | "preservation_pending" | "source_changed" | "preservation_failed";
/** A successful asynchronous flush cannot authorize departure from a different
 * account/workspace or a later registered owner. */
export class AccountNavigationBoundary {
  private guard: (() => Promise<boolean>) | null = null;
  private epoch = 0;
  constructor(private readonly identity: () => string) {}
  register(guard: () => Promise<boolean>): () => void {
    this.guard = guard;
    return () => { if (this.guard === guard) this.guard = null; };
  }
  async preserve(): Promise<AccountBoundaryResult> {
    const guard = this.guard, identity = this.identity(), epoch = ++this.epoch;
    try {
      if (guard && !await guard()) return "preservation_pending";
      if (epoch !== this.epoch || identity !== this.identity() || guard !== this.guard) return "source_changed";
      return "preserved";
    } catch { return "preservation_failed"; }
  }
}
