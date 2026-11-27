/* Shared viewport geometry for popup and submenu views. */
window._AppUIPopupPlacement = (()=>{
  function fit({x,y,width,height,viewportWidth,viewportHeight,padding=8}) {
    return {left:Math.max(padding,Math.min(x,viewportWidth-width-padding)),
      top:Math.max(padding,Math.min(y,viewportHeight-height-padding))};
  }
  function submenu({anchor,width,height,viewportWidth,viewportHeight,gap=0,padding=8}) {
    const right=anchor.right+gap;
    const x=right+width>viewportWidth-padding?anchor.left-width-gap:right;
    return fit({x,y:anchor.top,width,height,viewportWidth,viewportHeight,padding});
  }
  return {fit,submenu};
})();
