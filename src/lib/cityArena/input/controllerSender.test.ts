import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { createMemoryHub, createMemoryTransport } from "../net/memoryTransport";
import { decodeInput, type InputFrame } from "../net/wire";
import { EMPTY_INPUT } from "../sim/types";
import { createControllerSender } from "./controllerSender";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
describe("input-only controller transmission", () => {
  beforeEach(() => vi.clearAllMocks());
  it("stops publishing and ignores pending rejections when the room closes", async () => {
    const channel = createMemoryTransport(
      createMemoryHub(),
      "controller",
    ).channel("inputs");
    const publish = vi
      .spyOn(channel, "publish")
      .mockRejectedValue(new Error("connection closed"));
    const sender = createControllerSender(channel);
    sender.update(EMPTY_INPUT, 0);
    sender.stop();
    sender.release();
    sender.update(EMPTY_INPUT, 1000);
    await Promise.resolve();
    expect(publish).toHaveBeenCalledOnce();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
  it("latches brief presses, heartbeats and immediately releases on departure", () => {
    const hub = createMemoryHub();
    const controller = createMemoryTransport(hub, "controller");
    const host = createMemoryTransport(hub, "host");
    const received: ReturnType<typeof decodeInput>[] = [];
    host
      .channel("inputs")
      .subscribe("input", (message) =>
        received.push(decodeInput(message.data as InputFrame)),
      );
    const sender = createControllerSender(controller.channel("inputs"));
    sender.update(EMPTY_INPUT, 0);
    sender.update({ ...EMPTY_INPUT, enter: true }, 20);
    sender.update(EMPTY_INPUT, 70);
    hub.flush();
    expect(received.map((entry) => entry.input.enter)).toEqual([false, true]);
    sender.update(EMPTY_INPUT, 140);
    sender.update(EMPTY_INPUT, 500);
    sender.update(EMPTY_INPUT, 650);
    sender.release();
    hub.flush();
    expect(received).toHaveLength(5);
    expect(received.at(-1)?.input.move).toEqual([0, 0]);
    expect(received.at(-1)?.input.enter).toBe(false);
  });
  it("bounds held input to fifteen messages per second and reports a transport failure once", async () => {
    const channel = createMemoryTransport(
      createMemoryHub(),
      "controller",
    ).channel("inputs");
    const publish = vi
      .spyOn(channel, "publish")
      .mockRejectedValue(new Error("offline"));
    const sender = createControllerSender(channel);
    for (let at = 0; at < 1000; at += 10)
      sender.update({ ...EMPTY_INPUT, move: [1, 0] }, at);
    await Promise.resolve();
    expect(publish.mock.calls.length).toBeLessThanOrEqual(15);
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(1);
    publish.mockRestore();
  });
});
