import { NextRequest, NextResponse } from "next/server";
import { defaultSeasonWindow, generateTrainingDates } from "../../../../lib/training";

export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  const window = defaultSeasonWindow();
  const fromDate = new Date(from || window.from);
  const toDate = new Date(to || window.to);
  const dates = generateTrainingDates(fromDate, toDate);
  return NextResponse.json({ sessions: dates.map((d) => ({ date: d })) });
}


