import test from "node:test";
import assert from "node:assert/strict";
import { trackingState, mergeTracking, updateTracking, APPLICATION_STAGES, stageLabel } from "../app/shared/tracking.ts";

test("legacy saved and applied roles become independent dimensions",()=>{
 assert.deepEqual(trackingState({status:"saved"}),{shortlisted:true,applicationStatus:""});
 assert.deepEqual(trackingState({status:"applied"}),{shortlisted:false,applicationStatus:"applied"});
 assert.deepEqual(trackingState({status:"applied",shortlisted:true,applicationStatus:""}),{shortlisted:true,applicationStatus:""});
});
test("application progress never changes the shortlist",()=>{
 for(const shortlisted of [false,true]){
  let state=trackingState({shortlisted,applicationStatus:""});
  for(const stage of APPLICATION_STAGES){state=updateTracking(state,"applicationStatus",stage.value);assert.equal(state.shortlisted,shortlisted);assert.equal(state.applicationStatus,stage.value);}
  state=updateTracking(state,"applicationStatus","");assert.equal(state.shortlisted,shortlisted);assert.equal(state.applicationStatus,"");
 }
});
test("shortlisting never changes application progress",()=>{
 for(const stage of APPLICATION_STAGES){
  const state=trackingState({shortlisted:false,applicationStatus:stage.value});
  const saved=updateTracking(state,"shortlisted","true");assert.equal(saved.applicationStatus,stage.value);assert.ok(saved.shortlisted);
  const removed=updateTracking(saved,"shortlisted","false");assert.equal(removed.applicationStatus,stage.value);assert.equal(removed.shortlisted,false);
 }
});
test("cross-site records combine shortlist and the latest application stage",()=>{
 const merged=mergeTracking([{status:"saved"},{applicationStatus:"applied",updatedAt:"2026-10-12T10:00:00Z"},{applicationStatus:"assessment_centre",updatedAt:"2026-10-13T10:00:00Z"}]);
 assert.deepEqual(merged,{shortlisted:true,applicationStatus:"assessment_centre"});
 assert.equal(stageLabel(merged.applicationStatus),"Assessment centre (AC)");
});
test("invalid updates are rejected",()=>{
 const state={shortlisted:true,applicationStatus:"applied" as const};
 for(const [field,value] of [["applicationStatus","unknown"],["shortlisted","yes"],["status","rejected"]])assert.throws(()=>updateTracking(state,field,value));
});
