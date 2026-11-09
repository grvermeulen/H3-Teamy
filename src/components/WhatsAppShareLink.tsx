import type { ReactElement } from "react";
import { buildWhatsAppShareUrl } from "../lib/whatsappShare";

type Props = {
  /** Message WhatsApp opens with; the user picks the chat and sends it. */
  text: string;
  variant?: "primary" | "secondary";
  className?: string;
};

/**
 * Button-styled link that opens WhatsApp with `text` filled in. The user
 * chooses the chat (the team group) and taps send themselves.
 */
export default function WhatsAppShareLink({
  text,
  variant = "secondary",
  className,
}: Props): ReactElement {
  return (
    <a
      href={buildWhatsAppShareUrl(text)}
      target="_blank"
      rel="noopener noreferrer"
      className={`ui-btn${className ? ` ${className}` : ""}`}
      data-variant={variant}
    >
      Deel in WhatsApp
    </a>
  );
}
