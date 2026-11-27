/* AppUIArticle — ordered source blocks, rendered as safe DOM instead of source HTML. */
const AppUIArticle=(()=>{
  function safeUrl(value){try{const u=new URL(value,location.href);return ['http:','https:'].includes(u.protocol)?u.href:null;}catch{return null;}}
  function create({container,blocks=[],imageUrl,maxWidth=850}={}){
    if(!container)throw new Error('AppUIArticle requires a container');
    const el=document.createElement('article');el.className='appui-article';el.style.maxWidth=maxWidth+'px';el.style.lineHeight='1.75';container.append(el);
    let dead=false;
    function render(next){
      if(dead)return;el.replaceChildren();
      (next||[]).forEach(block=>{
        if(block.type==='image'){
          const figure=document.createElement('figure'),source=imageUrl?.(block)||block.local_url,url=source?safeUrl(source):null;
          if(url){
            const image=document.createElement('img');image.src=url;image.alt=block.alt||'';image.loading='lazy';image.style.maxWidth='100%';image.style.height='auto';image.referrerPolicy='no-referrer';
            image.addEventListener('error',()=>{const error=document.createElement('p');error.textContent='Saved image unavailable';image.replaceWith(error);},{once:true});figure.append(image);
          }else{const unavailable=document.createElement('p');unavailable.textContent='Image not saved locally';figure.append(unavailable);}
          if(block.alt){const caption=document.createElement('figcaption');caption.textContent=block.alt;figure.append(caption);}el.append(figure);
        }else{
          const value=document.createElement(block.type==='heading'?'h3':block.type==='quote'?'blockquote':'p');
          value.textContent=block.type==='video'?'Video: '+(block.title||block.videoId||'embedded video'):block.text||'';value.style.whiteSpace='pre-wrap';el.append(value);
        }
      });
    }
    render(blocks);return {el,update(next){render(Array.isArray(next)?next:next?.blocks||[]);},destroy(){dead=true;el.remove();}};
  }
  return {create};
})();
window.AppUIArticle=AppUIArticle;
