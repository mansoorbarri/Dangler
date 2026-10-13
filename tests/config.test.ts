import test from 'node:test';
import assert from 'node:assert/strict';
import {readSettings} from '../app/server/settings.ts';
import {sourceUrl,mapsUrl} from '../app/shared/jobs.ts';

test('server reads the configured location and limits instead of source defaults',()=>{
 const settings=readSettings({ORIGIN_POSTCODE:'EXAMPLE',ORIGIN_LATITUDE:'51',ORIGIN_LONGITUDE:'0',SEARCH_RADIUS_MILES:'25',DEFAULT_MAX_DRIVE_MINUTES:'45'});
 assert.deepEqual(settings,{origin:{postcode:'EXAMPLE',lat:51,lon:0},radius:25,maxDrive:45});
});
test('missing and invalid location settings fail without exposing values',()=>{
 assert.throws(()=>readSettings({}),/not configured/);
 assert.throws(()=>readSettings({ORIGIN_POSTCODE:'EXAMPLE',ORIGIN_LATITUDE:'91',ORIGIN_LONGITUDE:'0'}),/not configured/);
 assert.throws(()=>readSettings({ORIGIN_POSTCODE:'EXAMPLE',ORIGIN_LATITUDE:'51',ORIGIN_LONGITUDE:'0',SEARCH_RADIUS_MILES:'0'}),/Invalid search settings/);
});
test('search and map URLs use their explicit postcode argument',()=>{
 const search=new URL(sourceUrl('gov','EXAMPLE LOCATION',25));
 assert.equal(search.searchParams.get('location'),'EXAMPLE LOCATION');assert.equal(search.searchParams.get('distance'),'25');
 const maps=new URL(mapsUrl('Example workplace','EXAMPLE LOCATION'));
 assert.equal(maps.searchParams.get('origin'),'EXAMPLE LOCATION');
 assert.equal(maps.searchParams.get('destination'),'Example workplace');
});
