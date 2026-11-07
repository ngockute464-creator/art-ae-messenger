// Message action menus are a lightweight DOM overlay, not a whole-chat rerender.
// The previous toggle called render(), replacing the clicked node mid-event and
// occasionally making the popup flash or disappear on desktop/iOS.
function toggleMessageMenuDom(button){
 const key=button.dataset.menu||'';
 const app=root.querySelector('.app');
 if(!app||!key)return;
 const previous=app.querySelector(':scope > .actionDropdown');
 if(previous)previous.remove();
 for(const b of root.querySelectorAll('.moreBtn[aria-expanded="true"]'))b.setAttribute('aria-expanded','false');
 if(openMenu===key){openMenu=null;return}
 openMenu=key;
 let markup='';
 if(key.startsWith('message:')||key.startsWith('file:')){
  const itemId=key.slice(key.indexOf(':')+1);
  const message=key.startsWith('message:')
   ?data.messages.find(m=>m.id===itemId)
   :data.messages.find(m=>m.id===data.files.find(f=>f.id===itemId)?.message);
  if(!message||!isMine(message)){openMenu=null;return}
  markup=messageView(message);
 }else if(key.startsWith('pin:')){
  const pin=data.pins.find(p=>p.id===key.slice(4));
  if(!pin){openMenu=null;return}
  markup=pinCard(pin);
 }else{openMenu=null;return}
 const temporary=document.createElement('div');
 temporary.innerHTML=markup;
 const source=[...temporary.querySelectorAll('.moreBtn')].find(b=>b.dataset.menu===key);
 const dropdown=source?.closest('.menuWrap')?.querySelector('.actionDropdown');
 if(!dropdown){openMenu=null;return}
 app.appendChild(dropdown);
 button.setAttribute('aria-expanded','true');
 positionActiveMenu();
}
