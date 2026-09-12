import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectRoutes,
  isApiRouteFile,
  isPageFile,
  renderRoutesMarkdown,
  toPage,
  toPosixPath,
  toRoute,
} from "./scan-routes.ts";

const WINDOWS_APP_DIR = "C:\\dev\\H3-Teamy\\src\\app";
const POSIX_APP_DIR = "/home/dev/H3-Teamy/src/app";

describe("toPosixPath", () => {
  it("converts Windows separators to forward slashes", () => {
    expect(toPosixPath(`${WINDOWS_APP_DIR}\\api\\events\\route.ts`)).toBe(
      "C:/dev/H3-Teamy/src/app/api/events/route.ts",
    );
  });

  it("leaves POSIX paths unchanged", () => {
    expect(toPosixPath(`${POSIX_APP_DIR}/page.tsx`)).toBe(
      `${POSIX_APP_DIR}/page.tsx`,
    );
  });
});

describe("isApiRouteFile", () => {
  it("matches route handlers in Windows-style paths", () => {
    expect(isApiRouteFile(`${WINDOWS_APP_DIR}\\api\\events\\route.ts`)).toBe(
      true,
    );
    expect(
      isApiRouteFile(`${WINDOWS_APP_DIR}\\api\\auth\\[...nextauth]\\route.ts`),
    ).toBe(true);
  });

  it("matches route handlers in POSIX paths", () => {
    expect(isApiRouteFile(`${POSIX_APP_DIR}/api/events/route.ts`)).toBe(true);
  });

  it("ignores other files under api/", () => {
    expect(
      isApiRouteFile(`${WINDOWS_APP_DIR}\\api\\events\\route.test.ts`),
    ).toBe(false);
    expect(isApiRouteFile(`${WINDOWS_APP_DIR}\\api\\events\\helpers.ts`)).toBe(
      false,
    );
  });
});

describe("isPageFile", () => {
  it("matches pages in Windows-style paths", () => {
    expect(isPageFile(`${WINDOWS_APP_DIR}\\page.tsx`)).toBe(true);
    expect(
      isPageFile(`${WINDOWS_APP_DIR}\\trainer\\attendance\\[date]\\page.tsx`),
    ).toBe(true);
  });

  it("ignores layouts and page tests", () => {
    expect(isPageFile(`${WINDOWS_APP_DIR}\\layout.tsx`)).toBe(false);
    expect(
      isPageFile(
        `${WINDOWS_APP_DIR}\\trainer\\attendance\\[date]\\page.test.ts`,
      ),
    ).toBe(false);
  });
});

describe("toRoute", () => {
  it("maps a Windows-style route file to its URL path", () => {
    expect(
      toRoute(
        WINDOWS_APP_DIR,
        `${WINDOWS_APP_DIR}\\api\\auth\\[...nextauth]\\route.ts`,
      ),
    ).toBe("/api/auth/[...nextauth]");
  });

  it("maps a POSIX route file to its URL path", () => {
    expect(toRoute(POSIX_APP_DIR, `${POSIX_APP_DIR}/api/events/route.ts`)).toBe(
      "/api/events",
    );
  });
});

describe("toPage", () => {
  it("maps a Windows-style page file to its URL path", () => {
    expect(
      toPage(
        WINDOWS_APP_DIR,
        `${WINDOWS_APP_DIR}\\trainer\\attendance\\[date]\\page.tsx`,
      ),
    ).toBe("/trainer/attendance/[date]");
  });

  it("maps the root page to /", () => {
    expect(toPage(WINDOWS_APP_DIR, `${WINDOWS_APP_DIR}\\page.tsx`)).toBe("/");
    expect(toPage(POSIX_APP_DIR, `${POSIX_APP_DIR}/page.tsx`)).toBe("/");
  });
});

describe("collectRoutes", () => {
  const FIXTURE_FILES = [
    "api/auth/[...nextauth]/route.ts",
    "api/events/route.ts",
    "api/events/route.test.ts",
    "page.tsx",
    "login/page.tsx",
    "layout.tsx",
  ];
  let appDir: string;

  beforeEach(() => {
    appDir = fs.mkdtempSync(path.join(os.tmpdir(), "scan-routes-"));
    for (const file of FIXTURE_FILES) {
      const target = path.join(appDir, ...file.split("/"));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "");
    }
  });

  afterEach(() => {
    fs.rmSync(appDir, { recursive: true, force: true });
  });

  it("lists every API route and page beneath the app directory", () => {
    expect(collectRoutes(appDir)).toEqual({
      apiRoutes: ["/api/auth/[...nextauth]", "/api/events"],
      pages: ["/", "/login"],
    });
  });
});

describe("renderRoutesMarkdown", () => {
  it("renders API routes and pages as Markdown lists", () => {
    const markdown = renderRoutesMarkdown({
      apiRoutes: ["/api/events"],
      pages: ["/", "/login"],
    });

    expect(markdown).toBe(`# Routes Inventory

## API Routes

- /api/events

## Pages

- /
- /login`);
  });
});
