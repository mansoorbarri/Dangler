export const APPLICATION_STAGES = [
  { value: "applied", label: "Applied" },
  { value: "online_assessment", label: "Online assessment" },
  { value: "assessment_centre", label: "Assessment centre (AC)" },
  { value: "interview", label: "Interview" },
  { value: "offer", label: "Offer received" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Withdrawn" },
] as const;
export type ApplicationStatus = "" | typeof APPLICATION_STAGES[number]["value"];
export type TrackingRecord = {
  status?: string;
  shortlisted?: boolean;
  applicationStatus?: string;
  updatedAt?: string;
};
export type TrackingState = { shortlisted: boolean; applicationStatus: ApplicationStatus };
export function isApplicationStatus(value: string): value is ApplicationStatus {
  return value === "" || APPLICATION_STAGES.some(stage => stage.value === value);
}
export function trackingState(record: TrackingRecord): TrackingState {
  const applicationStatus = record.applicationStatus ?? (record.status === "applied" ? "applied" : "");
  return {
    shortlisted: record.shortlisted ?? record.status === "saved",
    applicationStatus: isApplicationStatus(applicationStatus) ? applicationStatus : "",
  };
}
export function mergeTracking(records: TrackingRecord[]): TrackingState {
  const ordered = [...records].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  return {
    shortlisted: records.some(record => trackingState(record).shortlisted),
    applicationStatus: ordered.map(trackingState).find(state => state.applicationStatus)?.applicationStatus || "",
  };
}
export function updateTracking(state: TrackingState, field: string, value: string): TrackingState {
  if (field === "shortlisted" && ["true", "false"].includes(value)) return { ...state, shortlisted: value === "true" };
  if (field === "applicationStatus" && isApplicationStatus(value)) return { ...state, applicationStatus: value };
  throw new Error("Invalid tracking update.");
}
export function stageLabel(status: ApplicationStatus): string {
  return APPLICATION_STAGES.find(stage => stage.value === status)?.label || "Not applied";
}
