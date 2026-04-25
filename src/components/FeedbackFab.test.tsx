import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import { usePathname } from "next/navigation";
import { useSession } from "./SessionContext";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as Sentry from "@sentry/nextjs";
import FeedbackFab from "./FeedbackFab";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/"),
}));

vi.mock("./SessionContext", () => ({
  useSession: vi.fn(),
}));

const sessionAuthenticated = {
  loading: false,
  loggedIn: true,
  isAdmin: false,
  isTrainer: false,
  refresh: vi.fn(async () => {}),
};
const sessionUnauthenticated = {
  loading: false,
  loggedIn: false,
  isAdmin: false,
  isTrainer: false,
  refresh: vi.fn(async () => {}),
};
const sessionLoading = {
  loading: true,
  loggedIn: false,
  isAdmin: false,
  isTrainer: false,
  refresh: vi.fn(async () => {}),
};

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** jsdom has no HTMLDialogElement.showModal — stub for component tests. */
const nativeShowModal = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
const nativeClose = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "close",
);

describe("FeedbackFab", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      writable: true,
      value: function showModalStub(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      writable: true,
      value: function closeStub(this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    });
  });

  afterAll(() => {
    if (nativeShowModal) {
      Object.defineProperty(
        HTMLDialogElement.prototype,
        "showModal",
        nativeShowModal,
      );
    } else {
      delete (HTMLDialogElement.prototype as unknown as { showModal?: unknown })
        .showModal;
    }
    if (nativeClose) {
      Object.defineProperty(HTMLDialogElement.prototype, "close", nativeClose);
    } else {
      delete (HTMLDialogElement.prototype as unknown as { close?: unknown })
        .close;
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(usePathname).mockReturnValue("/");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the fab when the user is signed in and not on /login", async () => {
    vi.mocked(usePathname).mockReturnValue("/events");
    vi.mocked(useSession).mockReturnValue(sessionAuthenticated);

    render(<FeedbackFab />);

    await waitFor(() => {
      expect(screen.getByLabelText("Stuur feedback")).toBeInTheDocument();
    });
  });

  it("hides the fab on /login even when the session has a user", () => {
    vi.mocked(usePathname).mockReturnValue("/login");
    vi.mocked(useSession).mockReturnValue(sessionAuthenticated);

    render(<FeedbackFab />);

    expect(screen.queryByLabelText("Stuur feedback")).not.toBeInTheDocument();
  });

  it("hides the fab when there is no session user", () => {
    vi.mocked(useSession).mockReturnValue(sessionUnauthenticated);

    render(<FeedbackFab />);

    expect(screen.queryByLabelText("Stuur feedback")).not.toBeInTheDocument();
  });

  it("hides the fab while session is loading", () => {
    vi.mocked(useSession).mockReturnValue(sessionLoading);

    render(<FeedbackFab />);

    expect(screen.queryByLabelText("Stuur feedback")).not.toBeInTheDocument();
  });

  it("captures feedback POST network errors in Sentry and shows a notice", async () => {
    vi.mocked(usePathname).mockReturnValue("/events");
    vi.mocked(useSession).mockReturnValue(sessionAuthenticated);
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("network down"));

    render(<FeedbackFab />);

    await waitFor(() => {
      expect(screen.getByLabelText("Stuur feedback")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Stuur feedback"));
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/RSVP-knop/i)).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText(/RSVP-knop/i), {
      target: { value: "Korte titel bug" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Wat deed je/i), {
      target: { value: "Langere toelichting hier." },
    });
    const form = screen
      .getByRole("button", { name: /Verstuur bugmelding/i })
      .closest("form");
    expect(form).toBeTruthy();
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ component: "feedback-fab" }),
      }),
    );
    expect(await screen.findByText(/Netwerkfout/i)).toBeInTheDocument();
  });

  it("submits feedback when POST succeeds", async () => {
    vi.mocked(usePathname).mockReturnValue("/events");
    vi.mocked(useSession).mockReturnValue(sessionAuthenticated);
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ ok: true }));

    render(<FeedbackFab />);

    await waitFor(() => {
      expect(screen.getByLabelText("Stuur feedback")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Stuur feedback"));
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/RSVP-knop/i)).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText(/RSVP-knop/i), {
      target: { value: "Korte titel bug" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Wat deed je/i), {
      target: { value: "Langere toelichting hier." },
    });
    const form = screen
      .getByRole("button", { name: /Verstuur bugmelding/i })
      .closest("form");
    expect(form).toBeTruthy();
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(screen.getByText(/Bedankt/i)).toBeInTheDocument();
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/feedback",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
