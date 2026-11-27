/* Scoped DataTable filter popup with shared action controls. */
window._AppUIDataTableFilter = (() => {
  function create({container,column,values,rawValues=[],value,onApply,onClose}) {
    const owner=AppUILifecycle.createScope();
    let closed=false;
    const popup=document.createElement('div');popup.className='appui-dt-filter-popup';
    popup.setAttribute('role','dialog');popup.setAttribute('aria-label','Filter '+(column.label||column.id));
    const content=document.createElement('div');content.style.padding='4px';
    const input=document.createElement('input');input.className='appui-dt-filter-input';
    input.placeholder='Filter '+(column.label||column.id)+'...';input.value=typeof value==='string'?value:value?.type==='contains'?value.value:'';
    input.setAttribute('aria-label','Filter '+(column.label||column.id));
    const suggestions=document.createElement('div');suggestions.className='appui-dt-filter-values';
    for(const value of values.slice(0,20)) {
      const button=document.createElement('button');button.type='button';button.className='appui-dt-filter-val';
      button.dataset.val=value;button.textContent=value.length>20?value.slice(0,20)+'\u2026':value;
      owner.listen(button,'click',()=>{if(!closed)input.value=value;});suggestions.appendChild(button);
    }
    const {numeric}=window._AppUIDataTableModel;
    const numbers=rawValues.map(numeric).filter(n=>n!==null);
    const rangeValue=value?.type==='range';
    const canRange=rangeValue||column.filterType==='number'||numbers.length>0&&rawValues.filter(v=>v!=null&&v!==''&&!(typeof v==='number'&&!Number.isFinite(v))).every(v=>numeric(v)!==null);
    const range=document.createElement('div');range.className='appui-dt-range-filter';
    const mode=document.createElement('select');mode.setAttribute('aria-label','Filter mode');
    for(const [id,text]of [['text','Text contains'],['range','Numeric range']]){const option=document.createElement('option');option.value=id;option.textContent=text;mode.append(option);}
    mode.value=rangeValue||canRange&&!value?'range':'text';
    const low=numbers.length?numbers.reduce((min,n)=>Math.min(min,n),Infinity):0,high=numbers.length?numbers.reduce((max,n)=>Math.max(max,n),-Infinity):1;
    const step=column.filterStep||(numbers.every(Number.isInteger)?1:Number(((high-low||1)/1000).toPrecision(3)));
    const fields=[],sliders=[];
    for(const [key,label,bound]of [['min','Minimum',low],['max','Maximum',high]]){
      const wrapper=document.createElement('label');wrapper.textContent=label;
      const field=document.createElement('input');field.type='number';field.step='any';field.placeholder='No limit';field.setAttribute('aria-label',label);field.value=rangeValue&&value[key]!=null?value[key]:'';
      const slider=document.createElement('input');slider.type='range';slider.min=low;slider.max=high===low?low+1:high;slider.step=step;slider.disabled=!numbers.length||high===low;slider.setAttribute('aria-label',label+' slider');slider.value=field.value||bound;
      wrapper.append(field,slider);range.append(wrapper);fields.push(field);sliders.push(slider);
      owner.listen(field,'input',()=>{slider.value=field.value===''?bound:field.value;});
      owner.listen(slider,'input',()=>{field.value=slider.value;const other=fields[key==='min'?1:0];if(other&&other.value!==''&&(key==='min'?Number(other.value)<Number(field.value):Number(other.value)>Number(field.value))){other.value=field.value;sliders[key==='min'?1:0].value=field.value;}});
    }
    const error=document.createElement('p');error.setAttribute('role','alert');error.hidden=true;
    const updateMode=()=>{input.hidden=suggestions.hidden=mode.value==='range';range.hidden=mode.value!=='range';};
    owner.listen(mode,'change',updateMode);updateMode();
    const actions=document.createElement('div');if(canRange)content.append(mode);else mode.value='text';updateMode();
    content.append(input,suggestions,range,error,actions);popup.appendChild(content);container.appendChild(popup);
    function close() {
      if(closed)return;closed=true;owner.destroy();popup.remove();onClose?.();
    }
    function apply(value) {if(closed)return;close();onApply(value);}
    function submit(){
      if(mode.value!=='range'){apply(input.value);return;}
      const [minimum,maximum]=fields,min=numeric(minimum.value),max=numeric(maximum.value);
      if(fields.some(field=>field.validity.badInput||field.value!==''&&numeric(field.value)===null)||min!==null&&max!==null&&min>max){error.textContent='Enter valid numbers with minimum no greater than maximum.';error.hidden=false;return;}
      apply(min===null&&max===null?'':{type:'range',min,max});
    }
    const toolbar=AppUIToolbar.create({container:actions,label:'Filter actions',items:[
      {className:'appui-dt-filter-apply',label:'Apply',primary:true,action:submit},
      {className:'appui-dt-filter-clear',label:'Clear',action:()=>apply('')},
    ]});owner.add(toolbar);
    owner.listen(content,'keydown',event=>{
      if(closed||event.isComposing)return;
      if(event.key==='Enter'){event.preventDefault();submit();}
      else if(event.key==='Escape'){event.preventDefault();close();}
    });
    let timer=setTimeout(()=>{
      timer=null;
      if(!closed&&popup.isConnected)owner.listen(document,'click',event=>{if(!popup.contains(event.target))close();});
    },0);
    owner.add(()=>{if(timer!==null)clearTimeout(timer);});
    (mode.value==='range'?fields[0]:input).focus();
    return {destroy:close};
  }
  function format(value){return value?.type==='range'?(value.min??'unbounded')+' to '+(value.max??'unbounded'):value?.type==='contains'?'contains '+value.value:String(value??'');}
  return {create,format};
})();

window.AppUITableFilter=window._AppUIDataTableFilter;
