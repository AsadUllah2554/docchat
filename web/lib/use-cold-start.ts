"use client";

import { useEffect, useState } from "react";

export const WAKING = "Waking the API. It sleeps after 15 minutes idle.";
export const STILL_WAKING = "Still waking up. This takes up to 30 seconds on a cold start.";

/**
 * The escalating line shown while a request is in flight against a possibly-sleeping API.
 *
 * Nothing appears for the first 3 seconds, so a warm request never flashes a message it does not
 * need. After 8 seconds the wording acknowledges the wait is longer than usual and then holds —
 * there is no third, more alarming message, because a cold start is normal behaviour here.
 *
 * `skip` short-circuits the whole thing once /health has already answered.
 *
 * `attempt` is the caller's own counter, incremented per request. The stage is stored against the
 * attempt that produced it, so a stage left over from a previous try cannot leak into the next
 * one — which keeps the reset out of the effect body and every timer cleared on unmount.
 */
export function useColdStartMessage(active: boolean, skip: boolean, attempt: number): string | null {
  const [reached, setReached] = useState({ attempt: -1, stage: 0 });

  useEffect(() => {
    if (!active || skip) return;
    const timers = [
      setTimeout(() => setReached({ attempt, stage: 1 }), 3_000),
      setTimeout(() => setReached({ attempt, stage: 2 }), 8_000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [active, skip, attempt]);

  if (!active || skip) return null;
  const stage = reached.attempt === attempt ? reached.stage : 0;
  return stage === 2 ? STILL_WAKING : stage === 1 ? WAKING : null;
}
