import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEnv} from '../scripts/env.mjs';
import worker from '../domain/worker.mjs';

test('environment parser handles quotes/comments without evaluating values',()=>{
 assert.deepEqual(parseEnv('# comment\nORIGIN_POSTCODE="EXAMPLE LOCATION"\nSEARCH_RADIUS_MILES=40 # comment\nVALUE=literal$(not-a-command)\n'),{ORIGIN_POSTCODE:'EXAMPLE LOCATION',SEARCH_RADIUS_MILES:'40',VALUE:'literal$(not-a-command)'});
 assert.throws(()=>parseEnv('not-an-entry'),/Invalid/);
});
test('unconfigured proxy fails closed without fetching',async()=>{
 const response=await worker.fetch(new Request('https://app.example.com/'),{});
 assert.equal(response.status,503);
});
