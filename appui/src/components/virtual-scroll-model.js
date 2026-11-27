/* Private height indexing and viewport ranges for shared virtual lists. */
window._AppUIVirtualScrollModel = {
  create({rowHeight,getRowHeight}) {
    let items=[],offsets=null;
    function offsetAt(index) { return offsets ? offsets[index] : index * rowHeight; }
    function indexAtOffset(offset) {
      if (!items.length) return -1;
      if (!offsets) return Math.max(0, Math.min(items.length - 1, Math.floor(offset / rowHeight)));
      let low = 0, high = items.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (offsets[middle + 1] <= offset) low = middle + 1;
        else high = middle;
      }
      return Math.min(low, items.length - 1);
    }

    function setItems(next) {
      items=next;offsets=getRowHeight?[0]:null;
      if(offsets)items.forEach((item,index)=>{
        const measured=Number(getRowHeight(item,index));
        offsets.push(offsets[index]+(Number.isFinite(measured)&&measured>0?measured:rowHeight));
      });
    }
    function range(scrollTop,height,buffer) {
      const visibleCount=Math.ceil(height/rowHeight);
      const start=offsets?Math.max(0,indexAtOffset(scrollTop)-buffer):Math.min(
        Math.max(0,Math.floor(scrollTop/rowHeight)-buffer),Math.max(0,items.length-visibleCount-buffer));
      const end=offsets?Math.min(items.length,indexAtOffset(scrollTop+height)+buffer+1)
        :Math.min(items.length,start+visibleCount+buffer*2);
      return {start,end};
    }
    return {setItems,offsetAt,indexAtOffset,range,clear(){items=[];offsets=null;}};
  },
};
