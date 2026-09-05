/** WebP source for the launcher icon artwork (see `docs/tech/branding/README.md`). */
export const GTA_LOGO_WEBP = "/branding/gta-h3-logo.webp";
/** PNG fallback for the launcher icon artwork, pre-sized to a square. */
export const GTA_LOGO_PNG = "/branding/gta-h3-logo.png";

/** Rendered width/height, in pixels, when `size` is not given. */
const DEFAULT_ICON_SIZE = 36;

/** Props for {@link CityArenaLaunchIcon}. */
type CityArenaLaunchIconProps = {
  size?: number;
  decorative?: boolean;
  className?: string;
};

/**
 * The GTA H3 launcher icon: the owner's logo artwork, rounded to fit the launcher card.
 *
 * @param size - Rendered width/height in pixels.
 * @param decorative - When true, hides the image from assistive tech (it sits next to a
 *   visible "GTA H3" title elsewhere on the card). Otherwise the image itself is named "GTA H3".
 * @param className - Extra classes for the wrapping `<picture>` (e.g. flex-layout utilities).
 */
export function CityArenaLaunchIcon({
  size = DEFAULT_ICON_SIZE,
  decorative = false,
  className,
}: CityArenaLaunchIconProps): React.JSX.Element {
  return (
    <picture className={className}>
      <source type="image/webp" srcSet={GTA_LOGO_WEBP} />
      <img
        src={GTA_LOGO_PNG}
        width={size}
        height={size}
        alt={decorative ? "" : "GTA H3"}
        aria-hidden={decorative ? true : undefined}
        decoding="async"
        className="rounded-xl"
      />
    </picture>
  );
}
