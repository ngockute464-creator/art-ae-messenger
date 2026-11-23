// Desktop/tablet projects drawer; mobile navigation remains unchanged.
let projectsDrawerOpen=false;
function projectsDrawerSync(){
 const app=root.querySelector('.app');
 if(!app)return;
 app.classList.toggle('projects-drawer-open',projectsDrawerOpen);
 const button=app.querySelector('.projectsDrawerToggle');
 button?.setAttribute('aria-expanded',String(projectsDrawerOpen));
}
function toggleProjectsDrawer(){
 if(window.matchMedia('(max-width: 650px)').matches)return;
 projectsDrawerOpen=!projectsDrawerOpen;
 projectsDrawerSync();
}
function closeProjectsDrawer(){
 if(!projectsDrawerOpen)return;
 projectsDrawerOpen=false;
 projectsDrawerSync();
}
root.addEventListener('click',event=>{
 if(!projectsDrawerOpen)return;
 if(event.target?.closest?.('.sidebar [data-act="project"],.sidebar [data-act="newProject"]'))
  queueMicrotask(closeProjectsDrawer);
});
root.addEventListener('keydown',event=>{
 if(event.key==='Escape'&&projectsDrawerOpen){
  event.preventDefault();
  closeProjectsDrawer();
  root.querySelector('.projectsDrawerToggle')?.focus();
 }
});
