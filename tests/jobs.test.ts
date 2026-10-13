import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseGov, parseHigherin, parseNgtu } from "../app/server/sources.ts";
import { dateValue, softwareMatch, groupJobs, isExpired, nearby } from "../app/shared/jobs.ts";
const fixture=(name:string)=>readFileSync(new URL("./fixtures/"+name,import.meta.url),"utf8");
test("current source responses parse and duplicate Thales adverts merge",()=>{
 const gov=parseGov(fixture("gov.html"));const higher=parseHigherin(fixture("higherin.html"));
 assert.equal(gov.length,1);assert.equal(gov[0].salary,"£24,000 a year");assert.equal(gov[0].location,"Stockport (SK3 0XB)");
 assert.equal(higher.nextPage,null);assert.equal(higher.jobs.length,5);
 const local=higher.jobs.filter(j=>nearby(j.location));assert.equal(local.length,1);
 const groups=groupJobs([...gov,...local]);assert.equal(groups.length,1);assert.equal(groups[0].length,2);
 assert.equal(parseNgtu(JSON.parse(fixture("ngtu.json"))).jobs.length,0);
});
test("strict software and level filtering",()=>{
 assert.ok(softwareMatch("Software Engineering Apprentice","Digital and technology solutions professional (level 6)"));
 assert.ok(softwareMatch("Software Developer","Degree Apprenticeship"));
 for(const [title,level] of [["Technology degree apprentice","degree"],["Cyber security apprentice","level 6"],["Software developer","Level 4"],["Software engineering degree","Level 7"],["Software engineering","Higher apprenticeship"]])assert.equal(softwareMatch(title,level),false);
});
test("date formats agree and expiry includes the whole closing day",()=>{
 assert.equal(dateValue("Closes on Wednesday 17 February 2027"),dateValue("17th February 2027"));
 assert.equal(dateValue("Ongoing"),null);
 const job=parseGov(fixture("gov.html"))[0];const close=job.closingAt!;
 assert.equal(isExpired(job,close+86399999),false);assert.equal(isExpired(job,close+86400000),true);
});
test("format failures are errors, not successful empty searches",()=>{
 assert.throws(()=>parseGov("<html>Access denied</html>"));assert.throws(()=>parseHigherin("<html>Challenge</html>"));assert.throws(()=>parseNgtu({data:[]}));
});
test("same-source and different-deadline roles are kept separate",()=>{
 const a=parseGov(fixture("gov.html"))[0];
 assert.equal(groupJobs([a,{...a,id:"another",url:a.url+"2"}]).length,2);
 assert.equal(groupJobs([a,{...a,id:"another",source:"higherin",url:a.url+"2",closingAt:a.closingAt!+86400000}]).length,2);
});
