import { canAccessApp, createClient, retryAuth, SignInWithGoogle, useAuth } from "lakebed/client";
import { useEffect, useRef, useState } from "preact/hooks";
import type app from "../server/index";
import { browserCommute } from "./commute";
import { APPLICATION_STAGES, mergeTracking, trackingState, stageLabel } from "../shared/tracking";
import { domainCallbackUrl } from "../shared/domain-auth";
import { DOMAIN_CONFIG } from "../shared/local-domain-config";
import { SOURCES, sourceUrl, nearby, isExpired, groupJobs, mapsUrl, type Job, type SourceKey, type SourceResult } from "../shared/jobs";

// Run before Lakebed's root starts its ordinary OAuth callback processing.
const domainCallback=domainCallbackUrl(window.location.href,DOMAIN_CONFIG);
if(domainCallback)window.location.replace(domainCallback);
const client=createClient<typeof app>();
type Route={minutes:number|null;miles:number|null;precision:string;error:string|null};
const button="cursor-pointer rounded-lg px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ef936d] disabled:cursor-wait disabled:opacity-50";
function Icon({name,size=20}:{name:string;size?:number}){
 const paths:Record<string,string>={arrow:"M7 17 17 7M7 7h10v10",search:"m21 21-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",pin:"M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0",bookmark:"M6 3h12v18l-6-4-6 4Z",refresh:"M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-4l2 3M19 16a8 8 0 0 1-13 4l-2-3",clock:"M12 8v4l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",check:"m5 12 4 4L19 6",code:"m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"};
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={paths[name]||paths.code}/></svg>;
}
export function App(){
 const auth=useAuth();
 useEffect(()=>{
  const root=document.documentElement;
  const previous={colorScheme:root.style.colorScheme,backgroundColor:root.style.backgroundColor};
  root.style.colorScheme="dark";
  root.style.backgroundColor="#141914";
  return ()=>{root.style.colorScheme=previous.colorScheme;root.style.backgroundColor=previous.backgroundColor;};
 },[]);
 return <div className="min-h-screen bg-[#141914] text-[#e9ede3]" style={{fontFamily:'"Trebuchet MS", sans-serif',colorScheme:'dark'}}>
 <header className="border-b border-[#364032] bg-[#141914] px-5 md:px-10"><div className="mx-auto flex max-w-7xl items-center justify-between py-5"><a href="/" className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#2d3d2a] text-[#d3e4b7]"><Icon name="code"/></span><span className="text-xl font-bold tracking-tight">dangler<span className="text-[#ef936d]">.</span></span></a><div className="flex items-center gap-3 text-xs text-[#a2ad99]"><span className="hidden sm:block">{auth.isSignedIn?auth.displayName:"Your personal search"}</span>{auth.isGuest&&<SignInWithGoogle className="rounded-lg border border-[#364032] px-3 py-2 text-xs text-[#e9ede3]"/>}</div></div></header>
 {auth.isLoading?<p className="p-10">Opening your search…</p>:canAccessApp()?<Dashboard/>:<main className="p-10"><p role="alert">{auth.error||"Sign in to open your search."}</p><button className={button} onClick={()=>void retryAuth()}>Retry connection</button><SignInWithGoogle/></main>}
 </div>;
}
function Dashboard(){
 const data=client.useQuery("dashboard");
 const origin=data?.settings.origin;
 const search=client.useAction("search"),store=client.useMutation("storeSearch"),trackRole=client.useMutation("trackRole"),commute=client.useAction("commute");
 const [results,setResults]=useState<Partial<Record<SourceKey,SourceResult>>>({});
 const [busy,setBusy]=useState(false),[working,setWorking]=useState<string[]>([]),[error,setError]=useState("");
 const [tab,setTab]=useState("all"),[query,setQuery]=useState(""),[region,setRegion]=useState("nearby"),[source,setSource]=useState("all"),[interest,setInterest]=useState(true),[sort,setSort]=useState("closing"),[maxDrive,setMaxDrive]=useState(60);
 const [stageFilter,setStageFilter]=useState("all"),[trackingBusy,setTrackingBusy]=useState<Record<string,boolean>>({});
 const [routes,setRoutes]=useState<Record<string,Route>>({}),[routeBusy,setRouteBusy]=useState<Record<string,boolean>>({});
 const started=useRef(false),refreshing=useRef(false);
 useEffect(()=>{if(!data||started.current)return;started.current=true;const cached:Partial<Record<SourceKey,SourceResult>>={};for(const s of data.searches){try{cached[s.source as SourceKey]=JSON.parse(s.payload);}catch{}}
 setMaxDrive(data.settings.maxDrive);setResults(cached);const stale=SOURCES.filter(s=>!cached[s.key]||Date.now()-(cached[s.key]?.checkedAt||0)>900000).map(s=>s.key);if(stale.length)void refresh(stale,cached);
 },[data]);
 async function refresh(keys:SourceKey[]=SOURCES.map(s=>s.key),previous=results){
  if(refreshing.current)return;refreshing.current=true;setBusy(true);setError("");setWorking(keys);
  await Promise.all(keys.map(async key=>{let jobs:Job[]=[],page:number|null=1,last:SourceResult|undefined;
   try{
    for(let n=0;n<10&&page;n++){const r=await search(key,page);last=r;if(r.error)break;jobs.push(...r.jobs);page=r.nextPage;if(jobs.length>=120)break;}
    if(!last)throw new Error("No response");
    const failed=!!last.error;const output:SourceResult={...last,jobs:failed?(previous[key]?.jobs||jobs):jobs.slice(0,120),incomplete:failed||!!page};
    setResults(r=>({...r,[key]:output}));await store(key,JSON.stringify(output));
   }catch(e){const output:SourceResult={jobs:previous[key]?.jobs||jobs,nextPage:null,checkedAt:Date.now(),error:e instanceof Error?e.message:"Search failed",incomplete:true};setResults(r=>({...r,[key]:output}));}
   finally{setWorking(w=>w.filter(k=>k!==key));}
  }));setBusy(false);refreshing.current=false;
 }
 async function route(j:Job){if(!origin)return;setRouteBusy(r=>({...r,[j.id]:true}));try{const browser=await browserCommute(j.location,origin);const r=browser.error?await commute(j.location):browser;setRoutes(old=>({...old,[j.id]:r}));}catch{setRoutes(old=>({...old,[j.id]:{minutes:null,miles:null,precision:"",error:"Route unavailable — check Google Maps"}}));}finally{setRouteBusy(r=>({...r,[j.id]:false}));}}
 const saved=data?.bookmarks||[];
 const allJobs=Object.values(results).flatMap(r=>r?.jobs||[]);
 for(const record of saved){if(!record.job)continue;try{const job=JSON.parse(record.job) as Job;if(!allJobs.some(j=>j.id===job.id))allJobs.push(job);}catch{}}
 const groups=groupJobs(allJobs);
 const status=(g:Job[])=>mergeTracking(saved.filter(b=>g.some(j=>j.id===b.key)));
 const shortlistCount=saved.filter(b=>trackingState(b).shortlisted).length;
 const applicationCount=saved.filter(b=>trackingState(b).applicationStatus).length;
 const visible=groups.filter(g=>{
  const j=g[0],s=status(g);if(tab==="all"&&g.every(j=>isExpired(j)))return false;if(tab==="saved"&&!s.shortlisted)return false;if(tab==="applied"&&!s.applicationStatus)return false;
  if(tab==="applied"&&stageFilter!=="all"&&s.applicationStatus!==stageFilter)return false;
  if(source!=="all"&&!g.some(j=>j.source===source))return false;if(!interest&&j.interest)return false;
  if(query&&!`${j.title} ${j.company} ${j.location}`.toLowerCase().includes(query.toLowerCase()))return false;
  if(region==="nearby"&&!g.some(j=>nearby(j.location)))return false;
  const r=routes[j.id];if(r?.minutes!=null&&r.minutes>maxDrive)return false;return true;
 }).sort((a,b)=>sort==="closing"?(a[0].closingAt||Infinity)-(b[0].closingAt||Infinity):sort==="salary"?salary(b[0].salary)-salary(a[0].salary):a[0].company.localeCompare(b[0].company));
 const checked=Object.values(results).map(r=>r?.checkedAt||0);const latest=checked.length?Math.max(...checked):0;
 async function mark(g:Job[],field:string,value:string){
  setTrackingBusy(b=>({...b,[g[0].id]:true}));
  try{setError("");await trackRole(JSON.stringify(g.map(j=>j.id)),field,value,JSON.stringify(g[0]));}
  catch(e){setError(e instanceof Error?e.message:"Could not update role");}
  finally{setTrackingBusy(b=>({...b,[g[0].id]:false}));}
 }
 function exportJobs(){const blob=new Blob([JSON.stringify(visible.map(g=>({...g[0],alsoListedOn:g.slice(1).map(j=>j.url),shortlisted:status(g).shortlisted,applicationStatus:status(g).applicationStatus})),null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="dangler-apprenticeships.json";a.click();URL.revokeObjectURL(url);}
 return <main className="mx-auto max-w-7xl px-5 pb-16 md:px-10">
 <section className="grid items-center gap-4 border-b border-[#364032] py-5 md:grid-cols-[1fr_360px]">
 <h1 className="text-xl font-bold tracking-tight">Software degree apprenticeships</h1>
 <div className="rounded-lg border border-[#364032] bg-[#1d241d] px-4 py-3">
 <div className="flex items-center justify-between gap-4 text-xs"><span className="flex items-center gap-2 text-[#a2ad99]"><Icon name="pin" size={14}/>{origin?.postcode||"Loading location…"}</span><label for="max-drive" className="text-[#a2ad99]">Maximum drive <span className="ml-2 font-bold text-[#e9ede3]">{maxDrive} min</span></label></div>
 <input id="max-drive" aria-label="Maximum driving time" type="range" min="30" max="90" step="15" value={maxDrive} onInput={e=>setMaxDrive(Number(e.currentTarget.value))} className="mt-2 w-full accent-[#abc581]"/>
 <p className="mt-1 text-[10px] text-[#a2ad99]">Road estimates exclude traffic.</p>
 </div>
 </section>
 <div className="mt-5 flex flex-wrap items-center justify-between gap-4"><nav aria-label="Listings" className="flex gap-5 text-sm">{[["all","Discover"],["saved","Shortlist"],["applied","Applied"]].map(([value,label])=><button onClick={()=>setTab(value)} className={"cursor-pointer border-b-2 pb-3 "+(tab===value?"border-[#ef936d] font-bold text-[#e9ede3]":"border-transparent text-[#a2ad99]")}>{label}{value!=="all"&&<span className="ml-2 rounded-full bg-[#303c2a] px-2 py-0.5 text-xs">{value==="saved"?shortlistCount:applicationCount}</span>}</button>)}</nav><div className="flex items-center gap-3"><span className="text-[11px] text-[#a2ad99]" role="status">{busy?"Checking sources…":latest?"Checked "+new Date(latest).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}):"Ready to search"}</span><button disabled={busy} onClick={()=>void refresh()} className={button+" flex items-center gap-2 bg-[#abc581] text-[#182012] hover:bg-[#c4dba5]"}><Icon name="refresh" size={16}/>{busy?"Searching…":"Refresh sources"}</button></div></div>
 <div className="mt-6 grid gap-6 lg:grid-cols-[235px_1fr]">
 <aside><div className="rounded-xl border border-[#364032] bg-[#1d241d] p-5"><div className="mb-5 flex items-center justify-between"><h2 className="text-sm font-bold">Refine your search</h2><button className="cursor-pointer text-xs text-[#a2ad99] underline" onClick={()=>{setQuery("");setRegion("nearby");setSource("all");setInterest(true);setMaxDrive(data?.settings.maxDrive||60);setStageFilter("all");}}>Reset</button></div>
 <label className="mb-2 block text-xs font-bold" for="keyword">Keyword or employer</label><div className="flex items-center gap-2 rounded-lg border border-[#364032] bg-[#171e16] px-3"><Icon name="search" size={15}/><input id="keyword" placeholder="e.g. Thales" value={query} onInput={e=>setQuery(e.currentTarget.value)} className="min-w-0 w-full bg-transparent py-3 text-xs outline-none placeholder:text-[#89967f]"/></div>
 <label className="mb-2 mt-5 block text-xs font-bold" for="region">Search area</label><select id="region" value={region} onChange={e=>setRegion(e.currentTarget.value)} className="w-full rounded-lg border border-[#364032] bg-[#171e16] p-3 text-xs"><option value="nearby">North West & remote</option><option value="all">All locations / check workplace</option></select><p className="mt-2 text-[11px] leading-5 text-[#a2ad99]">Manchester, Liverpool, Warrington, Bolton and nearby towns. Unknown locations are in All locations.</p>
 <label className="mb-2 mt-5 block text-xs font-bold" for="source">Listed on</label><select id="source" value={source} onChange={e=>setSource(e.currentTarget.value)} className="w-full rounded-lg border border-[#364032] bg-[#171e16] p-3 text-xs"><option value="all">All sources</option>{SOURCES.map(s=><option value={s.key}>{s.name}</option>)}</select>
 <label className="mt-5 flex cursor-pointer items-start gap-2 text-xs leading-5"><input type="checkbox" checked={interest} onChange={e=>setInterest(e.currentTarget.checked)} className="mt-1 accent-[#abc581]"/>Include register-your-interest listings</label>
 </div><div className="mt-5 px-1"><h2 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-[#a2ad99]">CONNECTED SOURCES</h2>{SOURCES.map(s=>{const r=results[s.key];return <div className="border-b border-[#364032] py-3"><div className="flex items-center justify-between text-xs"><a href={s.key==="gov"&&origin?sourceUrl(s.key,origin.postcode,data?.settings.radius):s.url} target="_blank" rel="noreferrer" className="font-bold hover:underline">{s.name} ↗</a><span className={"h-1.5 w-1.5 rounded-full "+(working.includes(s.key)?"animate-pulse bg-[#e9ac63]":r?.error?"bg-[#ed9574]":r?"bg-[#abc581]":"bg-[#596451]")}/></div><p className="mt-1 text-[10px] leading-4 text-[#a2ad99]">{working.includes(s.key)?"Searching…":r?.error?r.error:r?.incomplete?"Partial results — refresh again":r?`${r.jobs.length} software degree listings · checked`:s.label}</p></div>;})}</div></aside>
 <section aria-label="Apprenticeship results"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-bold">{visible.length} {visible.length===1?"opportunity":"opportunities"}<span className="ml-2 font-normal text-[#a2ad99]">{tab==="all"?"for your next step":"in your list"}</span></p><label className="flex items-center gap-2 text-xs text-[#a2ad99]">Sort by<select aria-label="Sort listings" value={sort} onChange={e=>setSort(e.currentTarget.value)} className="bg-transparent font-bold text-[#e9ede3]"><option value="closing">Closing soon</option><option value="salary">Highest salary</option><option value="employer">Employer A–Z</option></select></label></div>
 {tab==="applied"&&<label className="mb-5 flex flex-wrap items-center gap-3 text-xs text-[#a2ad99]">Application stage<select aria-label="Filter application stage" value={stageFilter} onChange={e=>setStageFilter(e.currentTarget.value)} className="rounded-lg border border-[#364032] bg-[#171e16] px-3 py-2 text-[#e9ede3]"><option value="all">All stages</option>{APPLICATION_STAGES.map(stage=><option value={stage.value}>{stage.label}</option>)}</select></label>}
 <p className="mb-5 text-[11px] leading-5 text-[#a2ad99]">Use “Check drive” to screen against {maxDrive} minutes. Unchecked journeys stay visible. Degree listings without an explicit Level 6 label need qualification confirmation.</p>
 {error&&<p role="alert" className="mb-4 rounded-lg bg-[#3c2821] p-4 text-sm">{error}</p>}
 {data===undefined?<p className="p-8">Loading your search…</p>:visible.length===0?<div className="rounded-xl border border-dashed border-[#46543e] bg-[#1d241d] px-6 py-14 text-center"><span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#253020] text-[#bad59a]"><Icon name="search"/></span><h2 className="text-xl" style={{fontFamily:"Georgia, serif"}}>{busy?"Finding your next chapter…":tab==="all"?"No matching roles right now": "Your list starts here"}</h2><p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[#a2ad99]">{busy?"The sources are being checked in parallel.":tab!=="all"?(tab==="applied"?"Set a role’s application status in Discover or Shortlist to track your progress here.":"Save a role from Discover to keep track of it here."):"Try All locations, adjust your filters or refresh the sources. Recruitment changes throughout the year."}</p></div>:<div className="space-y-4">{visible.map(g=>{const j=g[0],s=status(g),r=routes[j.id];return <article key={j.id} className="rounded-xl border border-[#364032] bg-[#1d241d] p-5 transition-shadow hover:shadow-md md:p-6"><div className="flex items-start justify-between gap-4"><div className="flex items-center gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#2b3725] text-sm font-bold text-[#bad59a]">{j.company.slice(0,2).toUpperCase()}</span><div><p className="text-xs font-bold tracking-wide text-[#bad59a]">{j.company}</p><p className="mt-1 text-[11px] text-[#a2ad99]">{g.map(j=>SOURCES.find(s=>s.key===j.source)?.name).join(" · ")}</p></div></div><button aria-label={s.shortlisted?"Remove from shortlist":"Save to shortlist"} aria-pressed={s.shortlisted} title={s.shortlisted?"Remove from shortlist":"Save to shortlist"} disabled={trackingBusy[j.id]} onClick={()=>void mark(g,"shortlisted",String(!s.shortlisted))} className={"cursor-pointer rounded-lg border p-2.5 "+(s.shortlisted?"border-[#657e4b] bg-[#2d3d27] text-[#bad59a]":"border-[#364032] text-[#a2ad99]")}><Icon name={s.shortlisted?"check":"bookmark"} size={18}/></button></div>
 <h2 className="mt-5 max-w-2xl text-xl leading-7 tracking-tight md:text-2xl" style={{fontFamily:"Georgia, serif"}}><a href={j.url} target="_blank" rel="noreferrer" className="hover:text-[#cce6ad]">{j.title}</a></h2><div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[#a2ad99]"><span className="flex items-center gap-1.5"><Icon name="pin" size={14}/>{j.location}</span><span className="font-bold text-[#bad59a]">{j.salary}</span><span className="rounded-md bg-[#2a3426] px-2 py-1">{/level\s*6/i.test(j.title+" "+j.course)?"Level 6":"Degree · verify level"}</span>{j.interest&&<span className="rounded-md bg-[#3b3021] px-2 py-1 text-[#edc28a]">Register your interest</span>}{s.applicationStatus&&<span className={"rounded-md px-2 py-1 "+(s.applicationStatus==="rejected"?"bg-[#3c2821] text-[#ef936d]":"bg-[#2d3d27] text-[#bad59a]")}>{stageLabel(s.applicationStatus)}</span>}{isExpired(j)&&<span className="rounded-md bg-[#3b3021] px-2 py-1 text-[#edc28a]">Vacancy closed</span>}</div>
 <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-[#364032] pt-4"><div className="text-[11px] leading-5 text-[#a2ad99]"><p><span className="font-bold text-[#bad59a]">Closes </span>{j.closing.replace(/^Closes on /,"")}</p>{j.start&&<p>Starts {j.start}</p>}</div><div className="flex flex-wrap items-center gap-2"><button disabled={routeBusy[j.id]} onClick={()=>void route(j)} className={button+" flex items-center gap-1.5 border border-[#364032] text-[#bad59a]"}><Icon name="clock" size={14}/>{routeBusy[j.id]?"Routing…":r?.minutes!=null?`~${r.minutes} min drive`:"Check drive"}</button><a href={j.url} target="_blank" rel="noreferrer" className={button+" flex items-center gap-2 bg-[#2b3725] text-[#bad59a] hover:bg-[#38492e]"}>View opportunity<Icon name="arrow" size={15}/></a></div></div>
 {r&&<p className="mt-3 text-[11px] text-[#a2ad99]">{r.error||r.precision}{r.minutes!=null?` · ${r.miles} road miles · no traffic`:""} · <a href={mapsUrl(j.location,origin?.postcode||"")} target="_blank" rel="noreferrer" className="underline">Check journey in Google Maps</a></p>}
 <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[#364032] pt-4 text-xs"><label for={"application-"+j.id} className="text-[#a2ad99]">Application status</label><select id={"application-"+j.id} aria-label={"Application status for "+j.title} disabled={trackingBusy[j.id]} value={s.applicationStatus} onChange={e=>void mark(g,"applicationStatus",e.currentTarget.value)} className="max-w-full rounded-lg border border-[#364032] bg-[#171e16] px-3 py-2 text-[#e9ede3] disabled:opacity-50"><option value="">Not applied</option>{APPLICATION_STAGES.map(stage=><option value={stage.value}>{stage.label}</option>)}</select>{trackingBusy[j.id]&&<span role="status" className="text-[#a2ad99]">Saving…</span>}</div>
 {g.length>1&&<p className="mt-3 text-[11px] text-[#a2ad99]">Also listed on {g.slice(1).map(j=><a className="mr-3 underline" href={j.url} target="_blank" rel="noreferrer">{SOURCES.find(s=>s.key===j.source)?.name}</a>)}</p>}
 </article>;})}</div>}
 <div className="mt-6 flex items-center justify-between gap-3 text-[11px] text-[#a2ad99]"><p>Live listings. No sample vacancies.</p><button disabled={!visible.length} onClick={exportJobs} className="cursor-pointer underline disabled:opacity-40">Export these results ↓</button></div>
 </section></div>
 <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-[#364032] pt-5 text-[11px] text-[#a2ad99]"><span>Built for the journey from learner to developer.</span><span>Powered by Lakebed · saved to your browser session</span></footer>
 </main>;
}
function salary(s:string){return Number(s.match(/[\d,]+/)?.[0]?.replace(/,/g,""))||0;}
