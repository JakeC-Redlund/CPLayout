import type { Calculation } from "@cplayout/geometry";

export type AdvisoryJobState<T> =
  | { status: "idle"; key: object | null }
  | { status: "pending"; key: object }
  | { status: "ready"; key: object; value: T }
  | { status: "error"; key: object; error: Error };

export interface AdvisoryScheduler {
  now(): number;
  schedule(callback: () => void): () => void;
}

const scheduler: AdvisoryScheduler = {
  now: () => performance.now(),
  schedule(callback) {
    const timer = setTimeout(callback, 0);
    return () => clearTimeout(timer);
  },
};

export class AdvisoryJob<T> {
  private state: AdvisoryJobState<T> = { status: "idle", key: null };
  private listeners = new Set<() => void>();
  private generation = 0;
  private cancelScheduled: (() => void) | null = null;
  private calculation: Calculation<T> | null = null;

  constructor(private readonly clock: AdvisoryScheduler = scheduler, private readonly sliceMs = 8) {
    if (!Number.isFinite(sliceMs) || sliceMs <= 0) throw new Error("Invalid advisory slice budget.");
  }

  getSnapshot = (): AdvisoryJobState<T> => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  request(key: object, create: () => Calculation<T>): void {
    if (this.state.key === key && (this.state.status === "pending" || this.state.status === "ready")) return;
    const generation = this.generation + 1;
    this.cancel();
    if (generation !== this.generation) return;
    this.publish({ status: "pending", key });
    const current = () => generation === this.generation;
    const run = () => {
      if (!current()) return;
      this.cancelScheduled = null;
      try {
        const calculation = this.calculation ?? create();
        if (!current()) return;
        this.calculation = calculation;
        const start = this.clock.now();
        let steps = 0;
        do {
          const next = calculation.next();
          if (!current()) return;
          if (next.done) {
            this.calculation = null;
            this.publish({ status: "ready", key, value: next.value });
            return;
          }
          steps += 1;
        } while (steps < 128 && this.clock.now() - start < this.sliceMs);
        this.cancelScheduled = this.clock.schedule(run);
      } catch (error) {
        if (!current()) return;
        this.calculation = null;
        this.publish({ status: "error", key, error: error instanceof Error ? error : new Error(String(error)) });
      }
    };
    if (current()) this.cancelScheduled = this.clock.schedule(run);
  }

  retry(key: object, create: () => Calculation<T>): void {
    if (this.state.status === "error" && this.state.key === key) this.request(key, create);
  }

  cancel(): void {
    this.generation += 1;
    this.cancelScheduled?.();
    this.cancelScheduled = null;
    // Pure calculation iterators own no resources; do not execute stale finalizers.
    this.calculation = null;
    if (this.state.status === "pending" || this.state.status === "error") this.publish({ status: "idle", key: this.state.key });
  }

  private publish(state: AdvisoryJobState<T>): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
