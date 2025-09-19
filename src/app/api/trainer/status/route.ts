import { NextRequest, NextResponse } from "next/server";
import { isTrainer } from "../../../../lib/trainer";

export async function GET(req: NextRequest) {
  const { isTrainer: ok, me } = await isTrainer(req);
  return NextResponse.json({ isTrainer: ok, me });
}



