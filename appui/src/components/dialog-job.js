/* Generic background-job dialog. Closing the view does not stop completion sync. */
var _AppUIDialogJob = window._AppUIDialogJob || {
  create({show,close}) {
    // waitJob(id) (optional): a LONG-POLL fetch (work_runner.wait with a short
    // timeout_s) used instead of getJob - it returns at completion or after its
    // own budget, so the next round starts at once instead of after pollInterval.
    return function job({title='Job progress',submit,getJob,waitJob,cancelJob,onComplete,signal,pollInterval=1000}={}) {
      const body=document.createElement('div'),status=document.createElement('p'),meter=document.createElement('progress'),detail=document.createElement('p');
      status.setAttribute('role','status');status.textContent='Queuing…';meter.max=1;body.append(status,meter,detail);
      let id,timer,stopped=false,completed=false,busy=false;
      const stop=()=>{stopped=true;clearTimeout(timer);signal?.removeEventListener('abort',stop);};
      signal?.addEventListener('abort',stop,{once:true});
      if(signal?.aborted)stop();
      const dialog=show({title,body,signal,buttons:[...(cancelJob?[{text:'Cancel job',action:()=>{if(id&&!completed)Promise.resolve().then(()=>cancelJob(id)).catch(error=>{detail.textContent=error.message;});return false;}}]:[]),{text:'Close',primary:true}]});
      async function poll(){
        if(stopped||busy||!id)return;busy=true;let delay=pollInterval;
        try{
          const record=await (waitJob||getJob)(id);if(stopped)return;
          if(waitJob)delay=50;
          const terminal=['done','failed','error','cancelled'].includes(record.status);
          const failed=record.status!=='done'||record.op_result?.ok===false;
          status.textContent=terminal?(failed?'Job '+(record.status==='done'?'failed':record.status):'Completed'):record.status;
          detail.textContent=record.error||record.op_result?._error||record.progress?.detail||'Waiting for worker';
          // Terminal jobs must never retain an indeterminate (animated) meter.
          if(terminal)meter.value=failed?Math.max(0,Math.min(1,Number(record.progress?.fraction)||0)):1;
          else if(record.progress?.fraction!=null)meter.value=record.progress.fraction;else meter.removeAttribute('value');
          if(terminal){
            if(!failed){detail.textContent='Updating results…';await onComplete?.(record);detail.textContent=record.op_result?.title?'Saved: '+record.op_result.title+' · '+(record.op_result.items?.length||0)+' places':'Results updated.';}
            completed=true;stop();
          }
        }catch(error){status.textContent='Progress / result refresh unavailable';detail.textContent=error.message+' · retrying';}
        finally{busy=false;if(!stopped)timer=setTimeout(poll,delay);}
      }
      const ready=Promise.resolve().then(async()=>{if(stopped)return null;id=await submit();if(!id)throw new Error('Worker returned no job identity');poll();return id;}).catch(error=>{status.textContent='Could not start job';detail.textContent=error.message;meter.value=0;stop();throw error;});
      ready.catch(()=>{});
      return {dialog,ready,destroy(){stop();if(dialog)close?.(dialog);}};
    };
  }
};
