/* Renderer-independent column order/visibility and optional view persistence. */
window.AppUITableColumns={
  create({columns:initial=[],stateKey,onChange=()=>{}}={}){
    const all=[],visible=[];let defaults=[],key;
    function save(){if(key)try{localStorage.setItem(key,JSON.stringify({order:all.map(c=>c.id),visible:visible.map(c=>c.id)}));}catch{}}
    function changed(){save();onChange();}
    function update(next,{reset=false,stateKey:nextKey=stateKey}={}){
      const newKey=nextKey?'appui.datatable.'+nextKey:null;
      reset=reset||key!==newKey;key=newKey;
      const previous=new Map(all.map(c=>[c.id,c])),selected=new Set(visible.map(c=>c.id));
      defaults=next.map(c=>({...c}));
      const ordered=reset?[]:all.map(c=>c.id);
      const incoming=new Map(next.map(c=>[c.id,{...c,...(!reset&&previous.get(c.id)?.width?{width:previous.get(c.id).width,minWidth:previous.get(c.id).minWidth}:{})}]));
      all.splice(0,all.length,...ordered.filter(id=>incoming.has(id)).map(id=>incoming.get(id)));
      for(const c of incoming.values())if(!all.some(old=>old.id===c.id))all.push(c);
      visible.splice(0,visible.length,...all.filter(c=>reset?!c.hidden:previous.has(c.id)?selected.has(c.id):!c.hidden));
      if(reset&&key)try{
        const state=JSON.parse(localStorage.getItem(key)||'null');
        if(Array.isArray(state?.order)&&Array.isArray(state?.visible)){
          const ids=[...new Set([...state.order,...all.map(c=>c.id)])];all.sort((a,b)=>ids.indexOf(a.id)-ids.indexOf(b.id));
          visible.splice(0,visible.length,...all.filter(c=>state.visible.includes(c.id)||!state.order.includes(c.id)&&!c.hidden));
        }
      }catch{}
      if(!visible.length&&all.length)visible.push(all[0]);
    }
    update(initial,{reset:true});
    function setVisible(id,show){const col=all.find(c=>c.id===id);if(!col||!show&&visible.length===1&&visible.includes(col))return false;
      const ids=new Set(visible.map(c=>c.id));if(show)ids.add(id);else ids.delete(id);
      visible.splice(0,visible.length,...all.filter(c=>ids.has(c.id)));changed();return true;}
    function move(id,target){const from=all.findIndex(c=>c.id===id),to=all.findIndex(c=>c.id===target);if(from<0||to<0||from===to)return;
      const ids=new Set(visible.map(c=>c.id)),[col]=all.splice(from,1);all.splice(to,0,col);visible.splice(0,visible.length,...all.filter(c=>ids.has(c.id)));changed();}
    function reset(){const ids=defaults.map(c=>c.id);all.sort((a,b)=>ids.indexOf(a.id)-ids.indexOf(b.id));visible.splice(0,visible.length,...all.filter(c=>!defaults.find(d=>d.id===c.id)?.hidden));if(!visible.length&&all.length)visible.push(all[0]);changed();}
    return {all,visible,update,setVisible,move,reset,save,getColumns:()=>all.map(c=>({...c,hidden:!visible.includes(c)}))};
  }
};
