/** Device families with different ways to mirror the game to a television. */
export const ARENA_CAST_DEVICES = ["iphone", "android", "computer"] as const;
/** A device family supported by the in-game mirroring guide. */
export type ArenaCastDevice = (typeof ARENA_CAST_DEVICES)[number];

/** Chooses mirroring instructions, including iPads that identify themselves as Macs. */
export function arenaCastDevice(
  device: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints">,
): ArenaCastDevice {
  if (
    /iPhone|iPad|iPod/i.test(device.userAgent) ||
    (device.platform === "MacIntel" && device.maxTouchPoints > 1)
  )
    return "iphone";
  return /Android/i.test(device.userAgent) ? "android" : "computer";
}

/** Dutch instructions for sharing the full game image through the device or browser. */
export const ARENA_CAST_HELP: Record<
  ArenaCastDevice,
  {
    label: string;
    title: string;
    steps: string[];
    note: string;
    helpUrl: string;
  }
> = {
  iphone: {
    label: "iPhone / iPad",
    title: "Beeld én geluid via AirPlay",
    steps: [
      "Verbind je iPhone of iPad en je AirPlay-tv met hetzelfde wifi-netwerk.",
      "Open het bedieningspaneel: veeg vanaf rechtsboven omlaag. Op een iPhone met thuisknop veeg je vanaf de onderrand omhoog.",
      "Tik op Synchrone weergave, de knop met twee overlappende rechthoeken. Kies je tv en vul eventueel de code in die op de tv verschijnt.",
      "Ga terug naar H3 en draai je telefoon horizontaal. Je hele scherm, inclusief de game, verschijnt op de tv.",
    ],
    note: "Alleen geluid? Kies Synchrone weergave. Het AirPlay-knopje bij de muziek deelt alleen het geluid van de game. Ontbreekt de knop? Voeg Synchrone weergave toe via ‘Voeg een regelaar toe’ in het bedieningspaneel.",
    helpUrl: "https://support.apple.com/nl-nl/102661",
  },
  android: {
    label: "Android",
    title: "Deel je scherm met Google Cast",
    steps: [
      "Verbind je telefoon en je Chromecast of tv met Google Cast met hetzelfde wifi-netwerk.",
      "Open Google Home. Houd bij Apparaten de tegel van je tv of Chromecast ingedrukt.",
      "Kies Casten en Mijn scherm casten. Bevestig het delen van je scherm of selecteer de app waarin H3 openstaat.",
      "Ga terug naar H3 en draai je telefoon horizontaal om verder te spelen.",
    ],
    note: "Heeft je telefoon Smart View of Scherm casten? Je kunt ook die schermspiegeloptie gebruiken als je tv die ondersteunt.",
    helpUrl: "https://support.google.com/chromecast/answer/6059461?hl=nl",
  },
  computer: {
    label: "Computer",
    title: "Cast het Chrome-tabblad",
    steps: [
      "Verbind je computer en je Chromecast of tv met Google Cast met hetzelfde wifi-netwerk.",
      "Open H3 in Chrome. Kies rechtsboven ⋮ → Casten, opslaan en delen → Casten.",
      "Kies bij Bronnen voor Tabblad casten en selecteer je tv. Houd dit spel-tabblad open.",
      "Op een Mac kun je ook Synchrone weergave in het bedieningspaneel gebruiken voor een AirPlay-tv. Een HDMI-kabel kan ook.",
    ],
    note: "Je huidige spelbeeld verschijnt op de tv. Het potje blijft doorgaan terwijl je de verbinding instelt.",
    helpUrl: "https://support.google.com/chromecast/answer/3228332?hl=nl",
  },
};
