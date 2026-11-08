import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GenerateReportButton from "./GenerateReportButton";

const sessionState = {
  loading: false,
  loggedIn: true,
  isAdmin: true,
  isTrainer: false,
  refresh: async () => {},
};

vi.mock("./SessionContext", () => ({ useSession: () => sessionState }));

describe("GenerateReportButton materialisatie", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("materialiseert bij selectie en stuurt FormData met bytes", async () => {
    const payload = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/report/extract")) {
        const body = init?.body;
        expect(body).toBeInstanceOf(FormData);
        const form = body as FormData;
        const image = form.get("image");
        expect(image).toBeInstanceOf(File);
        const file = image as File;
        expect(file.size).toBe(payload.byteLength);
        expect(file.name).toBe("screenshot-upload.jpg");
        expect(form.get("extractAttemptId")).toMatch(
          /^[0-9a-f-]{36}$/i,
        );
        return new Response(JSON.stringify({ result: { homeScore: 1, awayScore: 0, events: [{ quarter: 1, time: null, team: "home", type: "goal", player: null }] } }), {
          status: 200,
          headers: { "X-Report-Extract-Request-Id": "22222222-2222-4222-8222-222222222222" },
        });
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <GenerateReportButton eventId="evt-1" opponent="De Rijn H3 - Flevo H3" />,
    );

    const fileInput = screen
      .getByRole("button", { name: /Verslag genereren/i })
      .parentElement!.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
    const source = new File([payload], "gallery.jpeg", { type: "image/jpeg" });
    await fireEvent.change(fileInput, { target: { files: [source] } });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Verslag genereren/i }),
      ).not.toBeDisabled();
    });

    await fireEvent.click(screen.getByRole("button", { name: /Verslag genereren/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const extractCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/api/report/extract"),
    );
    expect(extractCall).toBeTruthy();
    const init = extractCall?.[1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.headers as Record<string, string>)?.["Content-Type"]).toBeUndefined();
  });

  it("negeert verouderde materialisatie bij snelle herselectie", async () => {
    const firstBytes = new Uint8Array([1, 2, 3]);
    const secondBytes = new Uint8Array([9, 9, 9, 9]);
    let readDelayResolve: (() => void) | null = null;

    vi.spyOn(File.prototype, "arrayBuffer").mockImplementation(function arrayBuffer(
      this: File,
    ) {
      const data = new Uint8Array((this as File).size);
      if (data.length === firstBytes.length) {
        return new Promise<ArrayBuffer>((resolve) => {
          readDelayResolve = () => resolve(data.buffer);
        });
      }
      data.set(secondBytes);
      return Promise.resolve(data.buffer);
    });

    render(
      <GenerateReportButton eventId="evt-1" opponent="De Rijn H3 - Flevo H3" />,
    );
    const fileInput = screen
      .getByRole("button", { name: /Verslag genereren/i })
      .parentElement!.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;

    const slow = new File([firstBytes], "a.jpg", { type: "image/jpeg" });
    const fast = new File([secondBytes], "b.jpg", { type: "image/jpeg" });
    await fireEvent.change(fileInput, { target: { files: [slow] } });
    await fireEvent.change(fileInput, { target: { files: [fast] } });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Verslag genereren/i }),
      ).not.toBeDisabled();
    });

    readDelayResolve?.();
  });
});
