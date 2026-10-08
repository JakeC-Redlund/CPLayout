import { expect, type Page } from "@playwright/test";

export interface OperationalReceiverFixture {
  nowMs: number; requestCount: number; closeCalls: number; openPorts: number;
  failCloseCount: number; deferClose: boolean; denyNext: boolean; initialPayload: string;
  grant(): void; releaseClose(): void; emit(payload: string): void; emitBytes(bytes: number[]): void; end(): void;
}
export type ReceiverFixtureWindow = Window & { operationalReceiver: OperationalReceiverFixture };

export function gga(time = "120000.00", quality = 4, identifier = "GNGGA", latitude = "4000.0000", longitude = "10500.0000", vertical = true): string {
  const body = `${identifier},${time},${latitude},N,${longitude},W,${quality},12,0.8,${vertical ? "1600" : ""},M,${vertical ? "-20" : ""},M,,`;
  return `$${body}*${[...body].reduce((sum, char) => sum ^ char.charCodeAt(0), 0).toString(16).padStart(2, "0")}\r\n`;
}

/** Synthetic browser serial boundary only; this never establishes physical receiver accuracy. */
export async function installOperationalReceiver(page: Page, initialPayload = ""): Promise<void> {
  await page.addInitScript(initial => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const grants: Array<() => void> = [];
    const closing: Array<() => void> = [];
    const fixture: OperationalReceiverFixture = {
      nowMs: 1000, requestCount: 0, closeCalls: 0, openPorts: 0,
      failCloseCount: 0, deferClose: false, denyNext: false, initialPayload: initial,
      grant() { grants.splice(0).forEach(resolve => resolve()); },
      releaseClose() { closing.splice(0).forEach(resolve => resolve()); },
      emit(payload) { controller.enqueue(new TextEncoder().encode(payload)); },
      emitBytes(bytes) { controller.enqueue(new Uint8Array(bytes)); },
      end() { controller.close(); },
    };
    (window as ReceiverFixtureWindow).operationalReceiver = fixture;
    Object.defineProperty(performance, "now", { configurable: true, value: () => fixture.nowMs });
    Object.defineProperty(navigator, "serial", { configurable: true, value: {
      async requestPort() {
        fixture.requestCount += 1;
        if (fixture.denyNext) { fixture.denyNext = false; throw new DOMException("Synthetic chooser denial", "NotFoundError"); }
        await new Promise<void>(resolve => grants.push(resolve));
        const readable = new ReadableStream<Uint8Array>({ start(value) { controller = value; if (fixture.initialPayload) fixture.emit(fixture.initialPayload); } });
        return { readable, writable: null,
          async open() { fixture.openPorts += 1; },
          async close() {
            fixture.closeCalls += 1;
            if (readable.locked) throw new Error("Readable stream remains locked");
            if (fixture.deferClose) await new Promise<void>(resolve => closing.push(resolve));
            if (fixture.failCloseCount > 0) { fixture.failCloseCount -= 1; throw new Error("Synthetic port cleanup failure"); }
            await readable.cancel(); fixture.openPorts -= 1;
          },
        };
      },
    } });
  }, initialPayload);
}

export async function connectOperationalReceiver(page: Page, requestCount = 1): Promise<void> {
  await page.getByRole("button", { name: "Connect receiver", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as ReceiverFixtureWindow).operationalReceiver.requestCount)).toBe(requestCount);
  await page.evaluate(() => (window as ReceiverFixtureWindow).operationalReceiver.grant());
  await expect(page.getByRole("button", { name: "Disconnect receiver", exact: true })).toBeEnabled();
}
export async function emitGga(page: Page, sentence: string, advanceMs = 1000): Promise<void> {
  await page.evaluate(({ sentence, advanceMs }) => {
    const fixture = (window as ReceiverFixtureWindow).operationalReceiver;
    fixture.nowMs += advanceMs; fixture.emit(sentence);
  }, { sentence, advanceMs });
}
