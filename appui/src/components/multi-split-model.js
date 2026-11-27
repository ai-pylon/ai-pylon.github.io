/* Private size calculations for MultiSplit; no DOM, storage or gesture ownership. */
window._AppUIMultiSplitModel = {
  normalize(values, count) {
    if (!Array.isArray(values) || values.length !== count || values.some(value => !Number.isFinite(value) || value < 0)) {
      return Array(count).fill(100 / count);
    }
    const total=values.reduce((sum,value)=>sum+value,0);
    return total>0?values.map(value=>value/total*100):Array(count).fill(100/count);
  },
  ratios(panes, sizes) {
    const total=sizes?100:panes.reduce((sum,pane)=>sum+(pane.ratio || 1/panes.length),0);
    return panes.map((pane,index)=>sizes?sizes[index]/total:(pane.ratio || 1/panes.length)/total);
  },
  visibleSizes(order, visible, count) {
    const sizes=Array(count).fill(0), total=visible.filter(Boolean).length;
    order.forEach((index,slot)=>{if(visible[slot])sizes[index]=100/total;});
    return sizes;
  }
};
