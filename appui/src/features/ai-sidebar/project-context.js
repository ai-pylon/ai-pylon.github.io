/* Shared project context cache for AI sidebar instances. */
window._AISidebarProjectContext=(function(){
  let cached=null,loading=null;
  const sources=[
    {label:'Project Rules',url:'/api/acp/file/read',body:{path:'.kiro/steering/project-rules.md'},fields:['content','text']},
    {label:'AppUI Page Guide',url:'/api/acp/file/read',body:{path:'pylon/appui_dev/docs/NEW_PAGE.md'},fields:['content','text']},
    {label:'Recent Changelog (last 20 commits)',url:'/api/git/log',body:{n:20,format:'oneline'},fields:['log','output','text']}
  ];
  async function load(){
    if(cached!==null)return cached;
    if(loading)return loading;
    loading=(async()=>{
      const parts=[];
      for(const source of sources){
        try{
          const data=await AppUI.services.api.requestOrThrow(source.url,source.body,{timeout:null});
          const content=source.fields.map(field=>data?.[field]).find(Boolean)||(typeof data==='string'?data:'');
          if(content)parts.push('['+source.label+']\n'+content);
        }catch{}
      }
      cached=parts.join('\n\n');loading=null;return cached;
    })();
    return loading;
  }
  return {load};
})();
