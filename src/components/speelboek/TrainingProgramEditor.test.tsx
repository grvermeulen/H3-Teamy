import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeRelativeDay } from "../../lib/training";
import TrainingProgramEditor from "./TrainingProgramEditor";

const TRAINING_DATE = "2026-11-11";

const programResponse = {
  items: [
    {
      id: "item-1",
      drillId: "tip-in",
      position: 0,
      minutes: 10,
      note: null,
      drill: { id: "tip-in", title: "Tip-in", category: "AANVAL" },
    },
  ],
  ackCounts: {},
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("TrainingProgramEditor delen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).includes("/api/speelboek/program/")
          ? jsonResponse(programResponse)
          : jsonResponse({ drills: [] }),
      ),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("deelt het opgeslagen programma met deeplinks in WhatsApp", async () => {
    render(<TrainingProgramEditor date={TRAINING_DATE} />);

    const link = await screen.findByRole("link", { name: "Deel in WhatsApp" });
    const text = new URL(link.getAttribute("href") ?? "").searchParams.get(
      "text",
    );
    const origin = window.location.origin;
    const dayLabel = describeRelativeDay(new Date(`${TRAINING_DATE}T12:00:00`));
    expect(text).toBe(
      [
        `Training ${dayLabel}: dit gaan we oefenen`,
        `• Tip-in (10 min) – ${origin}/speelboek/tip-in`,
        "",
        `Bekijk alles in het speelboek: ${origin}/speelboek`,
      ].join("\n"),
    );
  });

  it("laat pas delen na opslaan", async () => {
    render(<TrainingProgramEditor date={TRAINING_DATE} />);
    const minutes = await screen.findByLabelText("Minuten voor Tip-in");

    fireEvent.change(minutes, { target: { value: "15" } });

    expect(
      screen.queryByRole("link", { name: "Deel in WhatsApp" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Deel in WhatsApp" }),
    ).toBeDisabled();
  });

  it("houdt delen dicht als er tijdens het opslaan nog is bewerkt", async () => {
    let finishPut: (res: Response) => void = () => {};
    stubProgramFetch(() => new Promise((resolve) => (finishPut = resolve)));
    render(<TrainingProgramEditor date={TRAINING_DATE} />);
    const minutes = await screen.findByLabelText("Minuten voor Tip-in");

    fireEvent.change(minutes, { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Programma opslaan" }));
    fireEvent.change(minutes, { target: { value: "20" } });
    await act(async () => finishPut(jsonResponse(savedProgram("Tip-in", 15))));

    expect(
      screen.queryByRole("link", { name: "Deel in WhatsApp" }),
    ).not.toBeInTheDocument();
  });

  it("deelt de oefeningstitels zoals ze zijn opgeslagen", async () => {
    stubProgramFetch(async () =>
      jsonResponse(savedProgram("Tip-in vanaf links", 15)),
    );
    render(<TrainingProgramEditor date={TRAINING_DATE} />);
    const minutes = await screen.findByLabelText("Minuten voor Tip-in");

    fireEvent.change(minutes, { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Programma opslaan" }));

    const link = await screen.findByRole("link", { name: "Deel in WhatsApp" });
    const text = new URL(link.getAttribute("href") ?? "").searchParams.get(
      "text",
    );
    expect(text).toContain(
      `• Tip-in vanaf links (15 min) – ${window.location.origin}/speelboek/tip-in`,
    );
  });
});

function savedProgram(title: string, minutes: number) {
  const [item] = programResponse.items;
  return {
    date: TRAINING_DATE,
    items: [{ ...item, minutes, drill: { ...item.drill, title } }],
  };
}

/** GET answers with `programResponse`; the PUT answer comes from `put`. */
function stubProgramFetch(put: () => Promise<Response>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (!String(url).includes("/api/speelboek/program/")) {
        return jsonResponse({ drills: [] });
      }
      return init?.method === "PUT" ? put() : jsonResponse(programResponse);
    }),
  );
}
