import { describe, it, expect, beforeEach } from "vitest";
import { validateRegisterInput } from "./validateRegisterInput";

const validBody = {
  email: "user@example.com",
  password: "secret123",
  firstName: "Jan",
  lastName: "Jansen",
  invitationCode: "invite-code",
};

describe("validateRegisterInput", () => {
  beforeEach(() => {
    // No mocks; pure function tests
  });

  it("returns success with trimmed data for valid input", () => {
    const result = validateRegisterInput(validBody);
    expect(result).toEqual({
      success: true,
      data: {
        email: "user@example.com",
        trimmedFirstName: "Jan",
        trimmedLastName: "Jansen",
        trimmedPassword: "secret123",
        invitationCode: "invite-code",
      },
    });
  });

  it("trims firstName, lastName and password in success result", () => {
    const result = validateRegisterInput({
      ...validBody,
      firstName: "  Jan  ",
      lastName: "  Jansen  ",
      password: "  secret123  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.trimmedFirstName).toBe("Jan");
      expect(result.data.trimmedLastName).toBe("Jansen");
      expect(result.data.trimmedPassword).toBe("secret123");
    }
  });

  it("returns error when email is missing", () => {
    const result = validateRegisterInput({
      ...validBody,
      email: "",
    });
    expect(result).toEqual({
      success: false,
      error: "e-mail is verplicht",
    });
  });

  it("returns error when password is missing", () => {
    const result = validateRegisterInput({
      ...validBody,
      password: "",
    });
    expect(result).toEqual({
      success: false,
      error: "wachtwoord is verplicht",
    });
  });

  it("returns error when firstName is missing", () => {
    const result = validateRegisterInput({
      ...validBody,
      firstName: "",
    });
    expect(result).toEqual({
      success: false,
      error: "voornaam is verplicht",
    });
  });

  it("returns error when lastName is missing", () => {
    const result = validateRegisterInput({
      ...validBody,
      lastName: "",
    });
    expect(result).toEqual({
      success: false,
      error: "achternaam is verplicht",
    });
  });

  it("returns error when invitationCode is missing", () => {
    const result = validateRegisterInput({
      ...validBody,
      invitationCode: "",
    });
    expect(result).toEqual({
      success: false,
      error: "uitnodigingscode is verplicht",
    });
  });

  it("returns error when firstName is whitespace-only", () => {
    const result = validateRegisterInput({
      ...validBody,
      firstName: "   \t  ",
    });
    expect(result).toEqual({
      success: false,
      error: "voornaam mag niet alleen uit spaties bestaan",
    });
  });

  it("returns error when lastName is whitespace-only", () => {
    const result = validateRegisterInput({
      ...validBody,
      lastName: "   \n  ",
    });
    expect(result).toEqual({
      success: false,
      error: "achternaam mag niet alleen uit spaties bestaan",
    });
  });

  it("returns error when password is whitespace-only", () => {
    const result = validateRegisterInput({
      ...validBody,
      password: "   \t\n  ",
    });
    expect(result).toEqual({
      success: false,
      error: "wachtwoord mag niet alleen uit spaties bestaan",
    });
  });

  it("returns error for non-object body", () => {
    const result = validateRegisterInput("not an object");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("verplichte velden ontbreken of ongeldig");
    }
  });

  it("returns error when multiple fields missing uses first field error", () => {
    const result = validateRegisterInput({
      email: "",
      password: "",
      firstName: "",
      lastName: "",
      invitationCode: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect([
        "e-mail is verplicht",
        "wachtwoord is verplicht",
        "voornaam is verplicht",
        "achternaam is verplicht",
        "uitnodigingscode is verplicht",
      ]).toContain(result.error);
    }
  });
});
