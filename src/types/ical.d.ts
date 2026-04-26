declare module "ical" {
  interface IcalParseResult {
    [key: string]: unknown;
  }

  interface IcalModule {
    parseICS(str: string): IcalParseResult;
  }

  const ical: IcalModule;
  export = ical;
}
