/**
 * Cloudinary delivery transform: right-sized, auto-format (WebP/AVIF), auto-quality.
 * Cuts image bandwidth — the biggest per-visit cost of a busy store — by several times.
 * Non-Cloudinary URLs pass through unchanged.
 */
export function optimizedImage(url: string | null | undefined, width: number): string | null {
  if (!url) return null;
  const marker = '/image/upload/';
  const i = url.indexOf(marker);
  if (!url.includes('res.cloudinary.com') || i < 0) return url;
  return `${url.slice(0, i + marker.length)}f_auto,q_auto,c_limit,w_${width}/${url.slice(i + marker.length)}`;
}

/** Card thumbnails, full product images, logos. */
export const IMAGE_WIDTH = { card: 600, full: 1200, logo: 240, cover: 1200 } as const;
