import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../state/persist.ts", () => ({ saveAssets: async () => {} }));

/** A stand-in for the browser's WebSocket, driven by the test. */
class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }
  /** The server accepts the tab. */
  welcome() {
    this.readyState = 1;
    this.onopen?.();
    this.onmessage?.({ data: JSON.stringify({ t: "welcome", name: "storeshots-mcp-server", version: "test" }) });
  }
  /** The server drops the tab with a close code. */
  drop(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

const store = new Map<string, string>();
beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  store.clear();
  vi.stubGlobal("WebSocket", Object.assign(FakeSocket, { OPEN: 1 }));
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("live link", () => {
  it("reconnects when the server goes away", async () => {
    const { connectBridge, useBridge } = await import("./bridge.ts");
    connectBridge();
    FakeSocket.all[0]!.welcome();
    expect(useBridge.getState().status).toBe("connected");
    FakeSocket.all[0]!.drop(1006);
    expect(useBridge.getState().status).toBe("waiting");
    vi.advanceTimersByTime(1500);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("stays off when another tab takes the link, until asked to take it back", async () => {
    const { connectBridge, useBridge } = await import("./bridge.ts");
    connectBridge();
    FakeSocket.all[0]!.welcome();
    FakeSocket.all[0]!.drop(4000);
    expect(useBridge.getState().status).toBe("replaced");
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
    connectBridge();
    expect(FakeSocket.all).toHaveLength(2);
    FakeSocket.all[1]!.welcome();
    expect(useBridge.getState().status).toBe("connected");
  });
});
