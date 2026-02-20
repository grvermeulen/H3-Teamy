import { NextRequest, NextResponse } from "next/server";
import { getActiveUsers } from "@/lib/services/userService";

export async function GET(req: NextRequest) {
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";

  try {
    const users = await getActiveUsers(refresh);
    return NextResponse.json({ users });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: "users_query_failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
