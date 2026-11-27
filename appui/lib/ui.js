function showLoading(el){el.innerHTML='<div class="loading">Loading...</div>';}
function hideLoading(el){const l=el.querySelector('.loading');if(l)l.remove();}
function showError(el,msg){el.innerHTML=`<div class="error-banner">${msg}</div>`;}
function toast(msg,duration=3000){const t=document.createElement('div');t.className='toast show';t.textContent=msg;document.body.appendChild(t);setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),300);},duration);}
