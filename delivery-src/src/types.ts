export type Label = { kh: string; en: string };
export type EventDef = { code: number; key: string; kh: string; en: string; scope: 'trip' | 'dn' | 'any'; allowed: string; can: boolean };
export type PlanRow = { dn: string; date: string; plate: string; driver: string; round: string; custId: string; custName: string; so: string; fleet: string; kg: number; sched: string };
export type Boot = {
  user: { email: string; name: string; role: string; roleKey: string };
  events: EventDef[]; canCorrect: boolean; isAdmin: boolean;
  plates: { plate: string; type: string }[]; drivers: { name: string; plate: string; co: string }[];
  customers: { id: string; name: string }[]; warehouses: string[]; plan: PlanRow[];
  stages: Record<string, Label>; dnStatuses: Record<string, Label>; legs: Record<string, Label>; today: string; serverNow: number;
  settings?: { warnMin: number; lateMin: number; farKm: number }; companies?: string[]; plateCo?: Record<string, string>;
  complaintTypes?: string[]; canKpi?: boolean;
};
export type TripDn = { dn: string; cust: string; leg: string; kg: number };
export type TripSummary = {
  id: string; date: string; plate: string; driver: string; round: string; gateIn: number | null; gateOut: number | null;
  stage: string; closed: boolean; lastTime: number; lastCode: number; dns: TripDn[]; legacy: boolean;
};
export type LogRow = {
  row: number; key: string; code: number; eventText: string; recorder: string; trip: string; plate: string; driver: string; round: string;
  wh: string; so: string; dn: string; cust: string; websling: string; kg: number; remark: string; user: string; time: number; latlong: string;
  mode: string; truckPhoto: string; billPhoto: string; goodsPhoto: string;
};
export type DnLeg = { tripId: string; leg: string; kg: number; final: boolean; time: number; plate: string; cust: string };
export type DnInfo = {
  dn: string; plan: PlanRow | null; legs: DnLeg[]; status: string; kg: number; planKg: number; openTrips: string[]; rows?: LogRow[];
  complaints?: Complaint[]; siteRatings?: SiteRating[]; custRatings?: CustRating[]; rate?: Record<string, string>;
};
export type Proof = { key: string; dn: string; receiver: string; signature: string; photos: string[] };
export type TripDetail = TripSummary & {
  rows: LogRow[]; dnInfo: Record<string, DnInfo>; driverLink?: string;
  far?: Record<string, number>; proof?: Proof[]; rate?: Record<string, string>; company?: string; complaints?: number;
};
export type Complaint = {
  row: number; id: string; time: number; dn: string; trip: string; plate: string; co: string; cust: string; type: string; detail: string;
  source: string; by: string; status: string; resolvedAt: number; resolvedBy: string; resolution: string;
};
export type SiteRating = { row: number; time: number; trip: string; wait: string; help: string; access: string; custDelay: boolean; remark: string; confirmedBy: string };
export type CustRating = { time: number; trip: string; overall: number; polite: number; ontime: number; goods: number; comment: string };
export type Ops = { trips: TripSummary[]; dnToday: Record<string, number>; today: string; serverNow: number };
export type Warning = { code: string; en: string; kh: string; tripId?: string };
