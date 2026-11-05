// Keeps a project's display name and its Yandex Disk folder in sync.
// Not a distributed transaction: compensates a failed database update by moving
// the folder back, and reports any uncertain outcome instead of silently succeeding.
const API='https://cloud-api.yandex.net/v1/disk';
const err=(message,status=400)=>Object.assign(new Error(message),{status});
export function folderForName(name){
 const part=name.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/\.+$/,'').trim().slice(0,90)||'Проект';
 if(part.toLowerCase()==='_system')throw err('Служебное имя папки запрещено');
 return 'app:/'+part;
}
function validatePath(path){
 if(typeof path!=='string'||!/^app:\/[^/]+$/.test(path)||path.toLowerCase()==='app:/_system')throw err('Некорректная папка проекта',502);
 return path;
}
function remoteHref(href){
 const u=new URL(href);
 if(u.protocol!=='https:'||u.hostname!=='cloud-api.yandex.net'||!u.pathname.startsWith('/v1/disk/operations/'))throw err('Неожиданный адрес операции Яндекс Диска',502);
 return u.toString();
}
function authHeaders(){
 if(!process.env.YANDEX_DISK_TOKEN)throw err('Яндекс Диск не настроен',503);
 return {Authorization:'OAuth '+process.env.YANDEX_DISK_TOKEN};
}
async function diskMove(from,to){
 validatePath(from);validatePath(to);
 const url=new URL(API+'/resources/move');
 url.search=new URLSearchParams({from,path:to,overwrite:'false',force_async:'false'}).toString();
 const r=await fetch(url,{method:'POST',headers:authHeaders(),signal:AbortSignal.timeout(18000)});
 if(r.status===409)return (()=>{throw err('Папка с таким именем уже существует на Яндекс Диске',409)})();
 if(r.status===404)throw err('Исходная папка проекта не найдена на Яндекс Диске',409);
 if(r.status!==201&&r.status!==202)throw err('Яндекс Диск отказал в переименовании папки: '+r.status,502);
 if(r.status===201)return;
 const link=await r.json(),operationUrl=remoteHref(link.href);
 // Move may be asynchronous. Do not update PostgreSQL before confirmed success.
 for(let i=0;i<18;i++){
  const status=await fetch(operationUrl,{headers:authHeaders(),signal:AbortSignal.timeout(9000)});
  if(!status.ok)throw err('Не удалось проверить состояние перемещения папки',502);
  const data=await status.json();
  if(data.status==='success')return;
  if(data.status==='failed')throw err('Перемещение папки завершилось ошибкой на Яндекс Диске',502);
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 throw err('Перемещение папки ещё выполняется. Проверьте результат перед повторным переименованием',409);
}
export async function renameProjectFolder({oldProject,name,db}){
 const oldPath=validatePath(oldProject.folder_path);
 const newPath=folderForName(name);
 const wasMoved=oldPath!==newPath;
 if(wasMoved)await diskMove(oldPath,newPath);
 try{
  const patch={name,updated_at:Date.now()};
  if(wasMoved)patch.folder_path=newPath;
  // Compare-and-set avoids a stale request from silently overwriting a changed path.
  const rows=await db('project',{id:'eq.'+oldProject.id,folder_path:'eq.'+oldPath,deleted_at:'is.null'},{
   method:'PATCH',body:patch
  });
  if(rows.length!==1)throw err('Проект изменился во время переименования',409);
  return rows[0];
 }catch(problem){
  if(wasMoved){
   try{await diskMove(newPath,oldPath)}
   catch(rollbackError){
    console.error('ARTAE project rename rollback failed',oldProject.id,problem.message,rollbackError.message);
    throw err('Название проекта не изменено в базе, но возврат папки не подтверждён. Не повторяйте операцию; нужна проверка путей.',503);
   }
  }
  throw problem;
 }
}
