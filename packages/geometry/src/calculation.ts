export type Calculation<T> = Generator<void, T, void>;

/** Synchronous callers drain exactly the same steps as the scheduled UI. */
export function completeCalculation<T>(calculation: Calculation<T>): T {
  let step = calculation.next();
  while (!step.done) step = calculation.next();
  return step.value;
}
