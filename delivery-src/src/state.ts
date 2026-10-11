import { createContext, useContext, useEffect, useState } from 'react';
import type { Boot, Ops, TripSummary } from './types';

export type Ctx = {
  boot: Boot;
  ops: Ops | null;
  /** Bumped by the Refresh button: pages that load their own data reload when it changes. */
  tick: number;
  refreshOps: () => Promise<void>;
  setBusy: (b: boolean) => void;
};
export const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

// ---------------------------------------------------------------- hash routes: #/record?trip=…  #/trip/26-10-12-001
export type Route = { path: string[]; q: URLSearchParams };
export function parseHash(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  const [p, q] = h.split('?');
  return { path: p ? p.split('/').map(decodeURIComponent) : [], q: new URLSearchParams(q || '') };
}
export function useRoute() {
  const [r, setR] = useState(parseHash);
  useEffect(() => {
    const f = () => { setR(parseHash()); window.scrollTo(0, 0); };
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return r;
}
export const go = (h: string) => { location.hash = h; };
export const tripHref = (id: string) => '#/trip/' + encodeURIComponent(id);
export const dnHref = (dn: string) => '#/dn/' + encodeURIComponent(dn);

/** Trips still running: on the Active list and in the Record trip picker. */
export const openTrips = (ops: Ops | null): TripSummary[] => (ops ? ops.trips.filter(x => !x.closed) : []);
