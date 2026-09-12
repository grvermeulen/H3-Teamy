/** A validation failure in the map build; the message is meant for the terminal. */
export class MapBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MapBuildError";
  }
}
