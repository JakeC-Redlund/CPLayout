import assert from "node:assert/strict";
export function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
export function observe<T>(promise: Promise<T>) {
    let settled = false;
    void promise.then(() => { settled = true; }, () => { settled = true; });
    return { get settled() { return settled; } };
}
// An event-loop turn lets all already-runnable promise continuations settle.
export async function assertPending(observed: {
    readonly settled: boolean;
}) {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(observed.settled, false, 'operation must still be pending');
}
