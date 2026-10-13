import { execFileSync } from 'node:child_process';
import { loadEnv } from './env.mjs';
const root=new URL('../',import.meta.url);
const env=loadEnv(root,{});
const keys=['ORIGIN_POSTCODE','ORIGIN_LATITUDE','ORIGIN_LONGITUDE','LAKEBED_ORIGIN','CUSTOM_DOMAIN_ORIGIN','LAKEBED_DEPLOY_ID','CLOUDFLARE_ACCOUNT_ID'];
const sensitive=keys.filter(key=>env[key]).map(key=>[key,env[key]]);
const files=execFileSync('git',['ls-files','--cached','-z'],{cwd:root}).toString().split('\0').filter(Boolean);
const findings=[];
const secrets=[
 ['private key',/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
 ['GitHub token',/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/],
 ['cloud access key',/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
 ['API key',/\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/],
 ['JWT credential',/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{20,}\b/],
 ['personal home path',/\/home\/(?!user(?:\/|\b)|example(?:\/|\b))[A-Za-z0-9_.-]+\//],
];
for(const path of files){
 if((/(^|\/)\.env[^/]*$/.test(path)&&!path.endsWith('.env.example'))||/(^|\/)(?:data|\.local|\.lakebed|\.wrangler|node_modules)\//.test(path)||/lakebed\.json$|wrangler\.local\.jsonc$|local-domain-config\.ts$/.test(path))findings.push({path,reason:'private/local file staged'});
 let text=execFileSync('git',['show',':'+path],{cwd:root}).toString();
 for(let n=0;n<2;n++){try{text=decodeURIComponent(text.replace(/\+/g,' '));}catch{break;}}
 for(const [key,value] of sensitive){
  const found=key==='ORIGIN_POSTCODE'?text.toUpperCase().replace(/\s+/g,'').includes(value.toUpperCase().replace(/\s+/g,'')):text.includes(value);
  if(found)findings.push({path,reason:'configured personal value: '+key});
 }
 for(const [reason,pattern] of secrets)if(pattern.test(text))findings.push({path,reason});
}
if(findings.length){console.error(JSON.stringify(findings,null,2));process.exit(1);}
console.log(`Audited ${files.length} staged files: no configured personal values, private runtime files or recognised credential patterns found.`);
