import { artUrl } from '../art/pixelArt';

/**
 * A built pixel-art sprite at a whole-number scale (crisp, never smoothed). Decorative by
 * default: give `alt` only when the picture carries meaning the text around it doesn't.
 */
export function PixelArt({
  name,
  size,
  scale = 2,
  className = '',
  alt = '',
}: {
  name: string;
  size: readonly [number, number];
  scale?: number;
  className?: string;
  alt?: string;
}) {
  return (
    <img
      src={artUrl(name)}
      width={size[0] * scale}
      height={size[1] * scale}
      className={`pixel ${className}`.trim()}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      draggable={false}
      decoding="async"
    />
  );
}
