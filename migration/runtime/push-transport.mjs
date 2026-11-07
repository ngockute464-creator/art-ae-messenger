// Fixed, locally installed, pinned Web Push dependency. Never eval remote URLs.
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
let library;
export function getWebPush(){
 if(!library)library=require('/opt/artae-next/push-deps/node_modules/web-push');
 return library;
}
export function hasVapid(){
 return /^[A-Za-z0-9_-]{80,100}$/.test(process.env.ARTAE_VAPID_PUBLIC_KEY||'') &&
        /^[A-Za-z0-9_-]{35,60}$/.test(process.env.ARTAE_VAPID_PRIVATE_KEY||'');
}
export async function sendWebPush(subscription,payload){
 if(!hasVapid())throw Error('VAPID not provisioned');
 const wp=getWebPush();
 wp.setVapidDetails('https://artae.duckdns.org',
  process.env.ARTAE_VAPID_PUBLIC_KEY,process.env.ARTAE_VAPID_PRIVATE_KEY);
 return wp.sendNotification(subscription,JSON.stringify(payload),{
  TTL:300,urgency:'normal',timeout:9000
 });
}
