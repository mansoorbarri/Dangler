import { SOURCES, sourceUrl, dateValue, softwareMatch, type Job, type SourceKey, type SourceResult } from "../shared/jobs";
export function clean(s: string): string {
  return s.replace(/<[^>]*>/g," ").replace(/&#x([0-9a-f]+);/gi, (_,n) => String.fromCodePoint(parseInt(n,16))).replace(/&#(\d+);/g,(_,n) => String.fromCodePoint(Number(n))).replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/\s+/g," ").trim();
}
export function parseGov(html: string): Job[] {
  if (!html.includes("faa-search-results") && !html.includes("das-search-results") && !/no results|0 apprenticeships/i.test(html)) throw new Error("GOV.UK results format changed or access was blocked.");
  const jobs: Job[] = [];
  for (const block of html.split(/<li\b[^>]*class="[^"]*das-search-results__list-item[^"]*"[^>]*>/i).slice(1)) {
    const card = block.split("</li>")[0];
    const link = card.match(/<a\b[^>]*href="(\/apprenticeship\/[^"?#]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const field = (name: string) => clean(card.match(new RegExp("<b>"+name+"</b>([\\s\\S]*?)</p>","i"))?.[1] || "");
    const title = clean(link[2]), course = field("Training course");
    if (!softwareMatch(title, course)) continue;
    const closing = clean(card.match(/Closes on[^<]+/i)?.[0] || "Not specified");
    jobs.push({ id: "gov:"+link[1].split("/").pop(), source:"gov", title, course, company:clean(card.match(/<p class="govuk-body govuk-!-margin-bottom-0">([\s\S]*?)<\/p>/)?.[1] || "Employer not specified"), location:clean(card.match(/<p class="govuk-body das-!-color-dark-grey">([\s\S]*?)<\/p>/)?.[1] || "Location not specified"), salary:field("Wage") || "Not specified", closing, closingAt:dateValue(closing), start:field("Start date"), posted:clean(card.match(/Posted [^<]+/)?.[0] || ""), url:"https://www.findapprenticeship.service.gov.uk"+link[1], interest:/register.*interest/i.test(title) });
  }
  return jobs;
}
export function parseHigherin(html: string): { jobs: Job[]; nextPage: number | null } {
  const raw = html.match(/window\.__RMP_SEARCH_RESULTS_INITIAL_STATE__\s*=\s*([\s\S]*?)<\/script>/)?.[1]?.trim().replace(/;\s*$/,"");
  if (!raw) throw new Error("Higherin results format changed or access was blocked.");
  const data = JSON.parse(raw);
  if (!Array.isArray(data.data)) throw new Error("Higherin returned an unexpected response.");
  const jobs = data.data.filter((j: any) => softwareMatch(j.jobTitle || "",j.jobTypeName || "")).map((j: any): Job => ({ id:"higherin:"+j.id,source:"higherin", title:clean(j.jobTitle), company:clean(j.companyName), location:clean(j.jobLocationNames || "Location not specified"), salary:clean(j.salary || "Not specified"), closing:clean(j.deadline || "Not specified"), closingAt:dateValue(j.deadline || ""), start:clean(j.employmentStartDate || ""), course:clean(j.jobTypeName), posted:"", url:j.url, interest:!!j.isPreReg || /register.*interest/i.test(j.jobTitle) }));
  const p = data.meta?.pagination;
  return { jobs, nextPage:p?.hasMorePages ? p.currentPage+1 : null };
}
export function parseNgtu(data: any): { jobs: Job[]; nextPage: number | null } {
  const page = data?.data;
  if (!page || !Array.isArray(page.data)) throw new Error("Not Going To Uni returned an unexpected response.");
  const jobs = page.data.filter((j: any) => j.is_currently_live !== false && softwareMatch(j.title || "",j.category?.name || "")).map((j: any): Job => {
    const closing = j.end || j.job_expiration_date || "";
    return {id:"ngtu:"+j.id,source:"ngtu",title:clean(j.title),company:clean(j.provider?.name || "Employer not specified"),location:clean([...(j.towns || []).map((t:any)=>t.name), ...(j.counties || []).map((t:any)=>t.name)].join(", ") || j.address || "Location not specified"),salary:clean(j.salary || "Not specified"),closing:closing ? closing.slice(0,10) : "Not specified",closingAt:dateValue(closing),start:j.job_start_date || "",posted:j.live_from || "",course:clean(j.category?.name || ""),url:"https://notgoingtouni.co.uk/"+encodeURIComponent(j.provider?.provider_slug || "provider")+"/opportunity-detail/"+encodeURIComponent(j.opportunity_slug),interest:/register.*interest/i.test(j.title)};
  });
  return {jobs,nextPage:page.current_page < page.last_page ? page.current_page+1 : null};
}
export async function fetchSource(source: SourceKey, page: number, postcode: string, radius = 40): Promise<SourceResult> {
  const config = SOURCES.find(s=>s.key===source);
  if (!config || !Number.isInteger(page) || page<1 || page>10) throw new Error("Invalid source or page.");
  const url = source === "ngtu" ? `https://api.notgoingtouni.co.uk/api/fn/v1/opportunities?opportunity_type=degree-apprenticeship&per_page=24&page=${page}` : sourceUrl(source,postcode,radius)+(source === "gov" ? "&pageNumber=" : "?page=")+page;
  try {
    const res = await fetch(url,{headers:{"User-Agent":"Dangler/1.0 apprenticeship search",Accept:source==="ngtu"?"application/json":"text/html"},signal:AbortSignal.timeout(3800)});
    if (!res.ok) throw new Error(`HTTP ${res.status} — open this source directly or retry later.`);
    if(source==="ngtu") return {...parseNgtu(await res.json()),checkedAt:Date.now(),error:null};
    const html = await res.text();
    if(source==="higherin") return {...parseHigherin(html),checkedAt:Date.now(),error:null};
    const hasNext = /govuk-pagination__next|govuk-pagination__link[^>]*rel="next"/i.test(html);
    return {jobs:parseGov(html),nextPage:hasNext ? page+1 : null,checkedAt:Date.now(),error:null};
  } catch (e) {return {jobs:[],nextPage:null,checkedAt:Date.now(),error:e instanceof Error ? e.message : "Source request failed"};}
}
