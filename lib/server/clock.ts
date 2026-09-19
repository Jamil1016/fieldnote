import "server-only";

/** The request's "now". One place to read the clock keeps render code pure and easy to follow. */
export function serverNow(): Date {
  return new Date();
}
