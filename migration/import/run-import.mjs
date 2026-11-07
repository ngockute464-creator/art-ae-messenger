// Root-only one-time importer launcher.
// Reads only required Supabase settings from the EXISTING production environment
// file without executing the file or modifying it. Passes only these two values
// to the unprivileged local PostgreSQL app user. Never prints credentials.
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';

if(process.getuid?.()!==0){
  console.error('ARTAE_IMPORT_SETUP_ERROR: must launch as root to read the existing env file');
  process.exit(1);
}

function settings(path){
  const data=readFileSync(path,'utf8');
  const values=new Map();
  for(const line of data.split(/\r?\n/)){
    const match=/^\s*(?:export\s+)?([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.*?)\s*$/.exec(line);
    if(!match)continue;
    let val=match[2];
    if(val.length>=2&&((val.startsWith('"')&&val.endsWith('"'))||
                        (val.startsWith("'")&&val.endsWith("'"))))val=val.slice(1,-1);
    if(match[1]==='SUPABASE_URL'||match[1]==='SUPABASE_SECRET_KEY')values.set(match[1],val);
  }
  const url=values.get('SUPABASE_URL'),key=values.get('SUPABASE_SECRET_KEY');
  if(!url||!key)throw Error('Expected SUPABASE_URL and SUPABASE_SECRET_KEY were not found');
  return {SUPABASE_URL:url,SUPABASE_SECRET_KEY:key};
}
try{
  const env=settings('/etc/artae/artae.env');
  const child=spawn('/usr/sbin/runuser',[
    '--preserve-environment','-u','artae_app','--',
    '/usr/local/bin/node','/opt/artae-next/import/import-supabase.mjs'
  ],{
    stdio:'inherit',
    env:{PATH:'/usr/local/bin:/usr/bin:/bin',...env}
  });
  child.on('error',err=>{
    console.error('ARTAE_IMPORT_SETUP_ERROR:',err.message);
    process.exitCode=1;
  });
  child.on('exit',(code,signal)=>{
    if(signal)console.error('ARTAE_IMPORT_TERMINATED',signal);
    process.exitCode=code===0?0:1;
  });
}catch(err){
  console.error('ARTAE_IMPORT_SETUP_ERROR:',err.message);
  process.exitCode=1;
}
