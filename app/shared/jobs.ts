export type Origin = { postcode: string; lat: number; lon: number };
export const SOURCES = [
  { key: "gov", name: "GOV.UK", label: "Find an apprenticeship", url: "https://www.findapprenticeship.service.gov.uk/apprenticeships?sort=AgeAsc&levelIds=6" },
  { key: "higherin", name: "Higherin", label: "Formerly RateMyApprenticeship", url: "https://higherin.com/search-jobs/degree-apprenticeship/software-engineering" },
  { key: "ngtu", name: "Not Going To Uni", label: "Degree apprenticeship vacancies", url: "https://notgoingtouni.co.uk/opportunities/filter_by/opportunity_type/degree-apprenticeship" },
] as const;
export type SourceKey = typeof SOURCES[number]["key"];
export type Job = { id: string; source: SourceKey; title: string; company: string; location: string; salary: string; closing: string; closingAt: number | null; start: string; url: string; course: string; posted: string; interest: boolean };
export type SourceResult = { jobs: Job[]; nextPage: number | null; checkedAt: number; error: string | null; incomplete?: boolean };
export const TOWNS: Record<string, [number, number]> = {
  manchester: [53.4808,-2.2426], liverpool: [53.4084,-2.9916], warrington: [53.3900,-2.5970], bolton: [53.5769,-2.4282], wigan: [53.5440,-2.6325], salford: [53.4875,-2.2901], cheadle: [53.394,-2.214], stockport: [53.4106,-2.1575], altrincham: [53.3875,-2.3485], knutsford: [53.302,-2.374], radbroke: [53.274,-2.343], wilmslow: [53.328,-2.232], bury: [53.593,-2.298], rochdale: [53.61,-2.157], oldham: [53.54,-2.118], leigh: [53.497,-2.519], preston: [53.763,-2.703], chester: [53.191,-2.891], runcorn: [53.341,-2.733], widnes: [53.363,-2.728], "st helens": [53.454,-2.737], "st. helens": [53.454,-2.737], macclesfield: [53.259,-2.127], broughton: [53.163,-2.993], northwich: [53.262,-2.514], crewe: [53.099,-2.441], blackburn: [53.749,-2.484], burnley: [53.789,-2.248], "greater manchester": [53.4808,-2.2426], merseyside: [53.4084,-2.9916], cheshire: [53.262,-2.514], lancashire: [53.763,-2.703], "north west": [53.4808,-2.2426], "north-west": [53.4808,-2.2426]
};
export function softwareMatch(title: string, level: string): boolean {
  return /software\s*(engineering|engineer|development|developer)|(?:web|application|full.stack)\s*developer/i.test(title)
    && /level\s*6|\bl6\b|degree/i.test(title + " " + level)
    && !/level\s*[23457]|\bl[23457]\b|master/i.test(title + " " + level);
}
export function nearby(location: string): boolean { return /remote/i.test(location) || Object.keys(TOWNS).some(t => location.toLowerCase().includes(t)); }
export function isExpired(j: Job, now = Date.now()): boolean { return j.closingAt !== null && j.closingAt + 86400000 <= now; }
export function dateValue(raw: string): number | null {
  const s = raw.replace(/^Closes?\s+(?:on\s+)?/i, "").replace(/(\d)(st|nd|rd|th)\b/g, "$1").replace(/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b,?\s*/g, "").trim();
  if (!s || /ongoing|open|not specified/i.test(s)) return null;
  const value = Date.parse(s); return Number.isFinite(value) ? value : null;
}
export function fingerprint(j: Job): string {
  const normalize = (s: string) => s.toLowerCase().replace(/\b(limited|ltd|uk|plc|202\d|level|6|digital|and|technology|solutions|professional|degree|apprentice|apprenticeship)\b/g, "").replace(/[^a-z]/g, "");
  const town = Object.keys(TOWNS).find(t => j.location.toLowerCase().includes(t)) || j.location.toLowerCase();
  const year = (j.start + " " + j.title).match(/202\d/)?.[0] || (j.closingAt ? String(new Date(j.closingAt).getUTCFullYear()) : "");
  return normalize(j.company) + ":" + (town === "stockport" ? "cheadle" : town) + ":" + normalize(j.title.replace(/\s*-\s*(?:Cheadle|Stockport)$/i, "")) + ":" + year + ":" + j.closingAt;
}
export function groupJobs(jobs: Job[]): Job[][] {
  const groups: Job[][] = [];
  for (const job of jobs) {
    const same = groups.find(g => g.some(j => j.url === job.url || (j.source !== job.source && j.closingAt !== null && fingerprint(j) === fingerprint(job))));
    if (same) same.push(job); else groups.push([job]);
  }
  return groups;
}
export function mapsUrl(location: string, postcode: string): string { return "https://www.google.com/maps/dir/?api=1&origin=" + encodeURIComponent(postcode) + "&destination=" + encodeURIComponent(location) + "&travelmode=driving"; }

export function sourceUrl(source: SourceKey, postcode: string, radius = 40): string {
  const config = SOURCES.find(s=>s.key===source);
  if (!config) throw new Error("Invalid source.");
  if (source !== "gov") return config.url;
  const url = new URL(config.url);
  url.searchParams.set("location", postcode);
  url.searchParams.set("distance", String(radius));
  return url.toString();
}
