import { beforeEach, describe, expect, it } from "vitest";
import { lockBodyForModal } from "./modalLock";

describe("lockBodyForModal", () => {
  beforeEach(() => {
    document.body.className = "";
    document.body.style.overflow = "";
    document.body.style.touchAction = "";
    delete document.body.dataset.modalCount;
    delete document.body.dataset.modalOverflow;
    delete document.body.dataset.modalTouchAction;
  });

  it("zet modal-open en herstelt na unlock", () => {
    const unlock = lockBodyForModal();
    expect(document.body.classList.contains("modal-open")).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    unlock();
    expect(document.body.classList.contains("modal-open")).toBe(false);
  });

  it("ondersteunt geneste locks", () => {
    const u1 = lockBodyForModal();
    const u2 = lockBodyForModal();
    u2();
    expect(document.body.classList.contains("modal-open")).toBe(true);
    u1();
    expect(document.body.classList.contains("modal-open")).toBe(false);
  });
});
