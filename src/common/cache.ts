import { Header } from '@nestjs/common';

/**
 * Lets Vercel's CDN answer repeated public reads for a short while, so a store with heavy
 * traffic costs one function call and one database query per minute instead of one per visitor.
 * stale-while-revalidate keeps it fast while the next copy is fetched in the background.
 */
export const PublicCache = (seconds = 60) =>
  Header('Cache-Control', `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${seconds * 5}`);
