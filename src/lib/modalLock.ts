type BodyStyleSnapshot = {
  overflow: string;
  touchAction: string;
};

const MODAL_COUNT_KEY = "modalCount";
const MODAL_OVERFLOW_KEY = "modalOverflow";
const MODAL_TOUCH_KEY = "modalTouchAction";

function readCount(body: HTMLElement): number {
  const raw = body.dataset[MODAL_COUNT_KEY];
  const parsed = raw ? Number(raw) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function writeCount(body: HTMLElement, count: number) {
  if (count > 0) {
    body.dataset[MODAL_COUNT_KEY] = String(count);
  } else {
    delete body.dataset[MODAL_COUNT_KEY];
  }
}

function captureStyles(body: HTMLElement): BodyStyleSnapshot {
  return { overflow: body.style.overflow, touchAction: body.style.touchAction };
}

function storeStyles(body: HTMLElement, snapshot: BodyStyleSnapshot) {
  body.dataset[MODAL_OVERFLOW_KEY] = snapshot.overflow;
  body.dataset[MODAL_TOUCH_KEY] = snapshot.touchAction;
}

function restoreStyles(body: HTMLElement) {
  body.style.overflow = body.dataset[MODAL_OVERFLOW_KEY] ?? "";
  body.style.touchAction = body.dataset[MODAL_TOUCH_KEY] ?? "";
  delete body.dataset[MODAL_OVERFLOW_KEY];
  delete body.dataset[MODAL_TOUCH_KEY];
}

export function lockBodyForModal(): () => void {
  const { body } = document;
  const currentCount = readCount(body);
  if (currentCount === 0) {
    storeStyles(body, captureStyles(body));
    body.style.overflow = "hidden";
    body.style.touchAction = "none";
    body.classList.add("modal-open");
  }
  writeCount(body, currentCount + 1);

  return () => {
    const nextCount = Math.max(readCount(body) - 1, 0);
    writeCount(body, nextCount);
    if (nextCount === 0) {
      restoreStyles(body);
      body.classList.remove("modal-open");
    }
  };
}
