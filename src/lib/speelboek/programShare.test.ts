import { describe, expect, it } from "vitest";
import { buildProgramShareText } from "./programShare";

describe("buildProgramShareText", () => {
  it("lists each drill with its duration and a deep link", () => {
    const text = buildProgramShareText({
      appUrl: "https://h3.example",
      dayLabel: "woensdag",
      items: [
        { drillId: "tip-in", title: "Tip-in", minutes: 10 },
        { drillId: "4-2-man-meer", title: "4-2 man meer" },
      ],
    });

    expect(text).toBe(
      [
        "Training woensdag: dit gaan we oefenen",
        "• Tip-in (10 min) – https://h3.example/speelboek/tip-in",
        "• 4-2 man meer – https://h3.example/speelboek/4-2-man-meer",
        "",
        "Bekijk alles in het speelboek: https://h3.example/speelboek",
      ].join("\n"),
    );
  });
});
