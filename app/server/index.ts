import { action, boolean, capsule, mutation, query, string, number, table, userId } from "lakebed/server";
import { fetchSource } from "./sources";
import { SOURCES, TOWNS, type SourceKey, type SourceResult } from "../shared/jobs";
import { mergeTracking, updateTracking } from "../shared/tracking";
import { readSettings } from "./settings";

export default capsule({
  name:"Dangler — degree apprenticeship finder",
  auth:{requireSignIn:false},
  schema:{
    searches:table({owner:userId(),source:string(),payload:string(),updated:number()}).index("by_owner",["owner"]),
    bookmarks:table({owner:userId(),key:string(),status:string(),shortlisted:boolean().optional(),applicationStatus:string().optional(),job:string().optional()}).index("by_owner",["owner"]),
  },
  queries:{
    dashboard:query(async(ctx)=>{
      const {userId}=ctx.auth.requireIdentity();
      return {settings:readSettings(ctx.env),searches:await ctx.db.searches.withIndex("by_owner",q=>q.eq("owner",userId)).collect(),bookmarks:await ctx.db.bookmarks.withIndex("by_owner",q=>q.eq("owner",userId)).collect()};
    })
  },
  mutations:{
    storeSearch:mutation(async(ctx,source:string,payload:string)=>{
      const {userId}=ctx.auth.requireIdentity();
      if(!SOURCES.some(s=>s.key===source) || payload.length>60000) throw new Error("Invalid source result.");
      const parsed=JSON.parse(payload) as SourceResult;
      if(!Array.isArray(parsed.jobs)||parsed.jobs.length>150||!Number.isFinite(parsed.checkedAt))throw new Error("Invalid results.");
      for(const j of parsed.jobs) { const u=new URL(j.url); if(!["www.findapprenticeship.service.gov.uk","higherin.com","notgoingtouni.co.uk"].includes(u.hostname)||u.protocol!=="https:"||j.source!==source)throw new Error("Invalid listing URL."); }
      const rows=await ctx.db.searches.withIndex("by_owner",q=>q.eq("owner",userId)).collect();
      const existing=rows.find(r=>r.source===source);
      if(existing)await ctx.db.searches.update(existing.id,{payload,updated:Date.now()});
      else await ctx.db.searches.insert({owner:userId,source,payload,updated:Date.now()});
    }),
    trackRole:mutation(async(ctx,keysJson:string,field:string,value:string,jobJson:string)=>{
      const {userId}=ctx.auth.requireIdentity();
      const keys=JSON.parse(keysJson);
      if(!Array.isArray(keys)||keys.length<1||keys.length>10||keys.some(k=>typeof k!=="string"||k.length>300||!/^(gov|higherin|ngtu):[^\s]+$/.test(k)))throw new Error("Invalid role identifiers.");
      if(jobJson.length>8000)throw new Error("Listing snapshot is too large.");
      const job=JSON.parse(jobJson),url=new URL(job.url);
      if(!keys.includes(job.id)||url.protocol!=="https:"||!["www.findapprenticeship.service.gov.uk","higherin.com","notgoingtouni.co.uk"].includes(url.hostname))throw new Error("Invalid listing snapshot.");
      const rows=await ctx.db.bookmarks.withIndex("by_owner",q=>q.eq("owner",userId)).collect();
      const existing=rows.filter(r=>keys.includes(r.key));
      const state=updateTracking(mergeTracking(existing),field,value);
      const patch={key:job.id,status:"",...state,job:jobJson};
      // Consolidate aliases in one transaction, preserving the other dimension.
      if(state.shortlisted||state.applicationStatus){
        if(existing.length)await ctx.db.bookmarks.update(existing[0].id,patch);
        else await ctx.db.bookmarks.insert({owner:userId,...patch});
        for(const row of existing.slice(1))await ctx.db.bookmarks.delete(row.id);
      }else for(const row of existing)await ctx.db.bookmarks.delete(row.id);
    })
  },
  actions:{
    search:action(async(ctx,source:string,page:number)=>{ctx.auth.requireIdentity();const settings=readSettings(ctx.env);return fetchSource(source as SourceKey,page,settings.origin.postcode,settings.radius);}),
    commute:action(async(ctx,location:string)=>{
      ctx.auth.requireIdentity();
      const origin=readSettings(ctx.env).origin;
      let destination:[number,number]|undefined, precision="Town centre estimate";
      const postcode=location.match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i)?.[0];
      try{
        if(postcode){const r=await fetch("https://api.postcodes.io/postcodes/"+encodeURIComponent(postcode),{signal:AbortSignal.timeout(1200)});const d=await r.json();if(d.result){destination=[d.result.latitude,d.result.longitude];precision="Workplace postcode estimate";}}
        if(!destination){const town=Object.keys(TOWNS).find(t=>location.toLowerCase().includes(t));if(town && !["remote","greater manchester","north west","north-west","cheshire","lancashire","merseyside"].includes(town))destination=TOWNS[town];}
        if(!destination)return {minutes:null,miles:null,precision:"Workplace location needs checking",error:null};
        const path=`/route/v1/driving/${origin.lon},${origin.lat};${destination[1]},${destination[0]}?overview=false`;
        for(const host of ["https://router.project-osrm.org","https://routing.openstreetmap.de/routed-car"]){
          try {
            const response=await fetch(host+path,{headers:{"User-Agent":"Dangler/1.0 apprenticeship commute checker",Accept:"application/json"},signal:AbortSignal.timeout(1300)});
            if(!response.ok)throw new Error(`Road router HTTP ${response.status}`);
            const route=(await response.json()).routes?.[0];
            if(!response.ok || !route)throw new Error("No route returned");
            return {minutes:Math.ceil(route.duration/60),miles:Math.round(route.distance/1609.344),precision,error:null};
          }catch(e){ctx.log.warn("Road router unavailable",{host,error:e instanceof Error?e.message:String(e)});}
        }
        throw new Error("Both road routers unavailable");
      }catch(e){ctx.log.warn("Commute check failed",{error:e instanceof Error?e.message:String(e)});return {minutes:null,miles:null,precision,error:"Route unavailable — check Google Maps"};}
    })
  }
});
