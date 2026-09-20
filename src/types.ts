export const KINDS = ["redis", "postgres", "kv", "worker", "queue"] as const;
export const REGIONS = ["iad", "lhr", "sin", "syd"] as const;
export const SIZES = ["small", "medium", "large"] as const;
export const ACTIONS = ["provision", "restart", "teardown", "status"] as const;

export type Kind = (typeof KINDS)[number];
export type Region = (typeof REGIONS)[number];
export type Size = (typeof SIZES)[number];
export type Action = (typeof ACTIONS)[number];
export type ResourceStatus =
  | "allocating"
  | "configuring"
  | "running"
  | "restarting"
  | "draining"
  | "failed"
  | "gone";

export type JobParams = {
  action: Action;
  kind: Kind;
  name: string;
  team: string;
  region: Region;
  size: Size;
  deskId: string;
};

export type ResourceRow = {
  id: string;
  desk_id: string;
  kind: Kind;
  name: string;
  team: string;
  region: Region;
  size: Size;
  status: ResourceStatus;
  endpoint: string | null;
  created_at: string;
  updated_at: string;
};

export type JobRow = {
  id: string;
  desk_id: string;
  action: Action;
  resource_name: string;
  status: string;
  detail: string | null;
  created_at: string;
  updated_at: string;
};

export type RelayState = {
  lastJobId: string | null;
  lastAction: Action | null;
  lastResourceName: string | null;
  pendingTeardown: string | null;
};

export const MAX_RESOURCES = 8;
export const DESK_ID = "ops-desk";

export const SIZE_GIB: Record<Size, number> = {
  small: 1,
  medium: 4,
  large: 16
};

export const REGION_LABEL: Record<Region, string> = {
  iad: "Ashburn",
  lhr: "London",
  sin: "Singapore",
  syd: "Sydney"
};
