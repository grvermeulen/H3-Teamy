declare module "ical" {
  interface ParsedComponent {
    type?: string;
    summary?: string;
    start?: Date | string | number;
    end?: Date | string | number;
    uid?: string;
    location?: string;
    description?: string;
    [key: string]: unknown;
  }
  function parseICS(text: string): Record<string, ParsedComponent>;
  export default { parseICS };
}
