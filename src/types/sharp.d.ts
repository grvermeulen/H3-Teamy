declare module "sharp" {
  type SharpInput = Buffer | ArrayBuffer | Uint8Array | string;

  type ResizeFit = "cover" | "contain" | "fill" | "inside" | "outside";

  interface Metadata {
    width?: number;
    height?: number;
  }

  interface ResizeOptions {
    width?: number;
    height?: number;
    fit?: ResizeFit;
    withoutEnlargement?: boolean;
  }

  interface Sharp {
    metadata(): Promise<Metadata>;
    resize(options?: ResizeOptions): Sharp;
    png(): Sharp;
    toBuffer(): Promise<Buffer>;
  }

  function sharp(input?: SharpInput): Sharp;

  export default sharp;
}
