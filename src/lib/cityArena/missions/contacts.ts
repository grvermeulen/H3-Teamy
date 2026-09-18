import type { ZoneKey } from "../world/mapTypes";
import type { Point } from "../world/projection";

/** An authored street contact; offsets are desired metres, resolved onto safe pavement. */
export type MissionContact = {
  id: string;
  name: string;
  zone: ZoneKey;
  landmark: string;
  offset: Point;
  look: number;
  colour: string;
  greeting: string;
  missions: string[];
};

/** Eight recurring characters. Every contact resolves inside its playable zone. */
export const MISSION_CONTACTS: readonly MissionContact[] = [
  {
    id: "noor",
    name: "Noor Koerier",
    zone: "rhenen",
    landmark: "gastland",
    offset: [0, 140],
    look: 0,
    colour: "#f3cf68",
    greeting: "Heb je even? Ik heb iets dat ergens anders moet zijn.",
    missions: ["M01", "M02", "M03"],
  },
  {
    id: "mo",
    name: "Mo Motor",
    zone: "rhenen",
    landmark: "klein-zwitserland",
    offset: [-100, -20],
    look: 1,
    colour: "#e98d70",
    greeting: "Vier wielen, een beetje lef. Meer heb je niet nodig.",
    missions: ["M04", "M05", "M06"],
  },
  {
    id: "vera",
    name: "Vera Voss",
    zone: "wageningen",
    landmark: "grote-kerk-wageningen",
    offset: [40, 30],
    look: 2,
    colour: "#d989b5",
    greeting: "Ik zoek iemand die geen onnodige vragen stelt.",
    missions: ["M07", "M08", "M09"],
  },
  {
    id: "dex",
    name: "Dex De Schakel",
    zone: "wageningen",
    landmark: "grote-kerk-wageningen",
    offset: [-160, -80],
    look: 3,
    colour: "#94abd8",
    greeting: "Rustig kijken. Goed onthouden. Daarna praten we verder.",
    missions: ["M10", "M11", "M12"],
  },
  {
    id: "ada",
    name: "Ada Ampère",
    zone: "campus",
    landmark: "wur-forum",
    offset: [25, 35],
    look: 4,
    colour: "#6ed1c0",
    greeting: "Voor de wetenschap! En voor een nette vergoeding, natuurlijk.",
    missions: ["M13", "M14", "M15"],
  },
  {
    id: "bas",
    name: "Bas Bewijs",
    zone: "campus",
    landmark: "wur-orion",
    offset: [25, 40],
    look: 5,
    colour: "#c1a1e7",
    greeting: "Jij ziet het toch ook? Alles hangt samen!",
    missions: ["M16", "M17", "M18"],
  },
  {
    id: "fusilli",
    name: "Broeder Fusilli",
    zone: "bennekom",
    landmark: "oude-kerk-bennekom",
    offset: [25, 30],
    look: 1,
    colour: "#e8c785",
    greeting: "Gezegend zij uw vergiet. Hebt u vervoer?",
    missions: ["M19", "M20", "M21"],
  },
  {
    id: "zonnedauw",
    name: "DJ Zonnedauw",
    zone: "bennekom",
    landmark: "oude-kerk-bennekom",
    offset: [-180, -80],
    look: 4,
    colour: "#edaa78",
    greeting: "De zon staat goed, de bas staat klaar. Alleen de rest nog.",
    missions: ["M22", "M23", "M24"],
  },
];
