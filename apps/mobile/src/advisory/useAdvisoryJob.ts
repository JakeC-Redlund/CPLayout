import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Calculation } from "@cplayout/geometry";
import { AdvisoryJob, type AdvisoryJobState } from "./advisoryJob";

export function useAdvisoryJob<T>(request: { create: () => Calculation<T> }, enabled: boolean): AdvisoryJobState<T> & { retry: () => void } {
  const [job] = useState(() => new AdvisoryJob<T>());
  const activeRequest = useRef<object | null>(null);
  const state = useSyncExternalStore(job.subscribe, job.getSnapshot, job.getSnapshot);
  // Commit-time ownership closes the window for retained callbacks after unmount.
  // request() only queues work; geometry never executes inside the layout effect.
  useLayoutEffect(() => {
    activeRequest.current = enabled ? request : null;
    if (enabled) job.request(request, request.create);
    else job.cancel();
    return () => { activeRequest.current = null; job.cancel(); };
  }, [enabled, job, request]);
  const retry = useCallback(() => {
    if (activeRequest.current === request) job.retry(request, request.create);
  }, [job, request]);
  // Effects run after rendering. A previous revision must never leak into this render.
  if (state.key !== request) return { status: enabled ? "pending" : "idle", key: request, retry };
  return { ...state, retry };
}
