// Message actions are visible to everyone; only the original author can delete.
function objectActions(kind,id,cid,mine){
 const common=`data-kind="${kind}" data-id="${id}"`;
 const pinActions=`<div class="menuSectionTitle">Закрепление</div>${menuEntry('togglePin',`${pinned(kind,id,'convo',cid)?'☑':'□'} В разговоре`,`${common} data-scope="convo"`)}${menuEntry('togglePin',`${pinned(kind,id,'project',project)?'☑':'□'} В проекте`,`${common} data-scope="project"`)}<div class="menuRule"></div>${menuEntry('editLabels','🏷 Изменить метки',common)}`;
 if(kind==='message')
  return pinActions+menuEntry('editMessage','✎ Изменить сообщение',`data-id="${id}"`)+
   (mine?menuEntry('deleteMessage','Удалить сообщение',`data-id="${id}"`,'danger'):'');
 if(!mine)return pinActions;
 const msgId=data.files.find(f=>f.id===id)?.message||'';
 return pinActions+menuEntry('editMessage','✎ Изменить файл',`data-id="${msgId}"`)+
  menuEntry('deleteFile','Удалить файл',`data-id="${id}"`,'danger');
}
