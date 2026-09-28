"use client";

import { API_URL } from "./api";

/**
 * The API is a free Render instance: it sleeps after 15 minutes idle and cold starts in up to
 * 30 seconds. Pinging /health while the visitor reads the page and types usually means the
 * backend is already awake by the time they submit.
 *
 * An external cron job pings /health every 10 minutes as well. This is the fallback for when
 * that has not fired recently — one call on mount, no interval, no keepalive.
 */
let warm = false;

/** True once /health has answered 200 in this tab, which means the cold-start lines can be skipped. */
export const isApiWarm = () => warm;

/** Fire-and-forget. Nothing is awaited, nothing is rendered, failures are ignored. */
export function warmApi(): void {
  if (warm) return;
  fetch(`${API_URL}/health`)
    .then((res) => {
      if (res.ok) warm = true;
    })
    .catch(() => {});
}
