import { z } from "zod";

export const registerBodySchema = z.object({
  email: z.string().min(1, "e-mail is verplicht"),
  password: z.string().min(1, "wachtwoord is verplicht"),
  firstName: z
    .string()
    .min(1, "voornaam is verplicht")
    .refine(
      (s) => s.trim().length > 0,
      "voornaam mag niet alleen uit spaties bestaan",
    ),
  lastName: z
    .string()
    .min(1, "achternaam is verplicht")
    .refine(
      (s) => s.trim().length > 0,
      "achternaam mag niet alleen uit spaties bestaan",
    ),
  invitationCode: z.string().min(1, "uitnodigingscode is verplicht"),
});

export type ParsedRegisterInput = {
  email: string;
  trimmedFirstName: string;
  trimmedLastName: string;
  trimmedPassword: string;
  invitationCode: string;
};

export type ValidateRegisterInputResult =
  | { success: true; data: ParsedRegisterInput }
  | { success: false; error: string };

/**
 * Valideert en normaliseert de registratie-invoer (velden en trim).
 * Controleert niet op uitnodigingscode of bestaand e-mailadres; dat doet de route.
 *
 * @param body - Ongeparste request body (bijv. van req.json()).
 * @returns Success met genormaliseerde data of fout met gebruikersbericht.
 */
export function validateRegisterInput(
  body: unknown,
): ValidateRegisterInputResult {
  const parsed = registerBodySchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.flatten().fieldErrors;
    const msg =
      (first.email?.[0] ||
        first.password?.[0] ||
        first.firstName?.[0] ||
        first.lastName?.[0] ||
        first.invitationCode?.[0]) ??
      "verplichte velden ontbreken of ongeldig";
    return { success: false, error: msg };
  }

  const {
    email,
    password,
    firstName: rawFirstName,
    lastName: rawLastName,
    invitationCode,
  } = parsed.data;
  const trimmedFirstName = rawFirstName.trim();
  const trimmedLastName = rawLastName.trim();
  const trimmedPassword = password.trim();
  if (!trimmedPassword) {
    return {
      success: false,
      error: "wachtwoord mag niet alleen uit spaties bestaan",
    };
  }

  return {
    success: true,
    data: {
      email,
      trimmedFirstName,
      trimmedLastName,
      trimmedPassword,
      invitationCode,
    },
  };
}
