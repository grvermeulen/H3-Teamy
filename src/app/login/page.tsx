import type { JSX } from "react";
import LoginForm from "./LoginForm";
import { getSafeCallbackUrl } from "@/lib/loginCallbackUrl";

type SearchParamsRecord = Record<string, string | string[] | undefined>;

async function resolveSearchParams(
  input: SearchParamsRecord | Promise<SearchParamsRecord>,
): Promise<SearchParamsRecord> {
  return await Promise.resolve(input);
}

/**
 * Server Component: leest `callbackUrl` uit de URL en rendert het clientformulier.
 * Voorkomt hydratatieproblemen door `useSearchParams` in de clientboundary te vermijden.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParamsRecord | Promise<SearchParamsRecord>;
}): Promise<JSX.Element> {
  const sp = await resolveSearchParams(searchParams);
  const raw = sp.callbackUrl;
  const rawStr = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined;
  const callbackUrl = getSafeCallbackUrl(rawStr);

  return <LoginForm callbackUrl={callbackUrl} />;
}
