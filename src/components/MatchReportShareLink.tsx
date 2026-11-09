"use client";

import type { ReactElement } from "react";
import {
  buildMatchReportShareText,
  buildMatchReportUrl,
} from "../lib/whatsappShare";
import { useSiteOrigin } from "./useSiteOrigin";
import WhatsAppShareLink from "./WhatsAppShareLink";

type Props = {
  eventId: string;
  opponentTeam?: string;
  ourScore?: number;
  opponentScore?: number;
  variant?: "primary" | "secondary";
};

/**
 * "Deel in WhatsApp" for a match report: opens WhatsApp with a message that
 * links to the report on this site. Renders nothing until the site's origin is
 * known in the browser.
 */
export default function MatchReportShareLink({
  eventId,
  opponentTeam,
  ourScore,
  opponentScore,
  variant,
}: Props): ReactElement | null {
  const origin = useSiteOrigin();
  if (!origin) return null;
  const text = buildMatchReportShareText({
    reportUrl: buildMatchReportUrl(origin, eventId),
    opponentTeam,
    ourScore,
    opponentScore,
  });
  return <WhatsAppShareLink text={text} variant={variant} />;
}
