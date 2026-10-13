import test from 'node:test';
import assert from 'node:assert/strict';
import nativeWorker, { upstreamRequest as forwardRequest } from '../domain/worker.mjs';
import { DOMAIN_STATE_PREFIX, domainCallbackUrl as callbackUrl } from '../app/shared/domain-auth.ts';
const origin = 'https://example-capsule.lakebed.app';
const publicOrigin = 'https://app.example.com';
const env={LAKEBED_ORIGIN:origin,CUSTOM_DOMAIN_ORIGIN:publicOrigin};
const worker={fetch:request=>nativeWorker.fetch(request,env)};
const upstreamRequest=request=>forwardRequest(request,env);
const domainCallbackUrl=input=>callbackUrl(input,{lakebedOrigin:origin,domainOrigin:publicOrigin});

test('preserves paths, query, credentials and method while translating same-origin headers', async()=>{
 const request=new Request(publicOrigin+'/__lakebed/auth/upgrade?x=1',{method:'POST',headers:{Origin:publicOrigin,Referer:publicOrigin+'/',Cookie:'session=test','X-Lakebed-Token':'test-token'},body:'test-body'});
 const forwarded=upstreamRequest(request);
 assert.equal(forwarded.url,origin+'/__lakebed/auth/upgrade?x=1');
 assert.equal(forwarded.method,'POST');assert.equal(await forwarded.text(),'test-body');
 assert.equal(forwarded.headers.get('origin'),origin);
 assert.equal(forwarded.headers.get('referer'),origin+'/');
 assert.equal(forwarded.headers.get('cookie'),'session=test');
 assert.equal(forwarded.headers.get('x-lakebed-token'),'test-token');
});
test('does not turn unrelated origins into authorised same-origin callers',()=>{
 const r=upstreamRequest(new Request(publicOrigin+'/__lakebed/auth/session',{headers:{Origin:'https://unrelated.example'}}));
 assert.equal(r.headers.get('origin'),'https://unrelated.example');
});
test('only rewrites redirects back to this app and prevents session caching',async()=>{
 const original=globalThis.fetch;
 try {
  globalThis.fetch=async()=>new Response(null,{status:302,headers:{Location:origin+'/auth/callback?code=test','Set-Cookie':'session=test; Secure; HttpOnly'}});
  const r=await worker.fetch(new Request(publicOrigin+'/auth/callback'));
  assert.equal(r.headers.get('location'),publicOrigin+'/auth/callback?code=test');
  assert.equal(r.headers.get('set-cookie'),'session=test; Secure; HttpOnly');
  assert.equal(r.headers.get('cache-control'),'private, no-store');
  globalThis.fetch=async()=>new Response(null,{status:302,headers:{Location:'https://auth.lakebed.dev/authorize'}});
  const other=await worker.fetch(new Request(publicOrigin+'/'));
  assert.equal(other.headers.get('location'),'https://auth.lakebed.dev/authorize');
 }finally{globalThis.fetch=original;}
});
test('WebSocket upgrades pass through without reconstructing the connection',async()=>{
 const original=globalThis.fetch;
 try{const upgraded={status:101,webSocket:{}};globalThis.fetch=async()=>upgraded;assert.equal(await worker.fetch(new Request(publicOrigin+'/__lakebed/ws')),upgraded);}finally{globalThis.fetch=original;}
});

test('sign-in translates only the fixed client and callback, preserving PKCE',async()=>{
 const request=new Request(publicOrigin+'/authorize?'+new URLSearchParams({client_id:'origin:'+publicOrigin,redirect_uri:publicOrigin+'/auth/callback',state:'test-state',code_challenge:'test-challenge',code_challenge_method:'S256'}));
 const response=await worker.fetch(request);const url=new URL(response.headers.get('location'));
 assert.equal(url.origin,'https://auth.lakebed.dev');assert.equal(url.searchParams.get('client_id'),'origin:'+origin);
 assert.equal(url.searchParams.get('redirect_uri'),origin+'/auth/callback');assert.equal(url.searchParams.get('state'),DOMAIN_STATE_PREFIX+'test-state');assert.equal(url.searchParams.get('code_challenge'),'test-challenge');
 const invalid=await worker.fetch(new Request(publicOrigin+'/authorize?client_id=other&redirect_uri=https://other.example'));
 assert.equal(invalid.status,400);
});
test('token exchange preserves the one-time code and private PKCE verifier',async()=>{
 const original=globalThis.fetch;
 try{
  let forwarded;
  globalThis.fetch=async(url,options)=>{forwarded={url,options};return new Response('{}',{headers:{'Content-Type':'application/json'}});};
  const body=new URLSearchParams({client_id:'origin:'+publicOrigin,redirect_uri:publicOrigin+'/auth/callback',grant_type:'authorization_code',code:'one-time-code',code_verifier:'private-verifier'});
  const result=await worker.fetch(new Request(publicOrigin+'/token',{method:'POST',headers:{Origin:publicOrigin,Cookie:'guest-private','X-Lakebed-Token':'private'},body}));
  assert.equal(result.status,200);assert.equal(forwarded.url,'https://auth.lakebed.dev/token');
  const params=new URLSearchParams(forwarded.options.body);assert.equal(params.get('code_verifier'),'private-verifier');assert.equal(params.get('code'),'one-time-code');assert.equal(params.get('client_id'),'origin:'+origin);
  assert.equal(forwarded.options.headers.Cookie,undefined);assert.equal(forwarded.options.headers['X-Lakebed-Token'],undefined);
  const denied=await worker.fetch(new Request(publicOrigin+'/token',{method:'POST',headers:{Origin:'https://unrelated.example'},body}));assert.equal(denied.status,403);
 }finally{globalThis.fetch=original;}
});
test('app shell uses the proxy sign-in broker without changing assets',async()=>{
 const original=globalThis.fetch;
 try{globalThis.fetch=async()=>new Response('<script>window.__LAKEBED_AUTH__ = {"authBaseUrl":"https://auth.lakebed.dev","requireSignIn":false};</script><script src="/client.js"></script>',{headers:{'Content-Type':'text/html','ETag':'original'}});
 const response=await worker.fetch(new Request(publicOrigin+'/'));const html=await response.text();
 assert.ok(html.includes('"authBaseUrl":"'+publicOrigin+'"'));assert.ok(html.includes('src="/client.js"'));assert.equal(response.headers.get('etag'),null);
 }finally{globalThis.fetch=original;}
});
test('only tagged canonical callbacks return to the fixed custom domain',()=>{
 const state='S'.repeat(43);
 const incoming=origin+'/auth/callback?'+new URLSearchParams({state:DOMAIN_STATE_PREFIX+state,code:'one-time-code',return_to:'https://unrelated.example'});
 const callback=new URL(domainCallbackUrl(incoming));
 assert.equal(callback.origin,publicOrigin);assert.equal(callback.searchParams.get('state'),state);assert.equal(callback.searchParams.get('code'),'one-time-code');assert.equal(callback.searchParams.get('return_to'),null);
 assert.equal(domainCallbackUrl(origin+'/auth/callback?state='+state),null);
 assert.equal(domainCallbackUrl(publicOrigin+'/auth/callback?state='+DOMAIN_STATE_PREFIX+state),null);
 assert.equal(domainCallbackUrl(origin+'/auth/callback?state='+DOMAIN_STATE_PREFIX+'short'),null);
});
