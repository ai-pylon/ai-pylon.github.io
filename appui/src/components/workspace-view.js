/* Private structure for Workspace groups; tabs, layout and render ownership stay in the controller. */
window._AppUIWorkspaceView = {
  root() {
    const element=document.createElement('div');element.className='appui-workspace';return element;
  },
  group(id) {
    const element=document.createElement('div');element.className='appui-workspace-group';element.dataset.groupId=id;
    const tabBar=document.createElement('div');tabBar.className='appui-workspace-tabbar';element.appendChild(tabBar);
    const content=document.createElement('div');content.className='appui-workspace-content';element.appendChild(content);
    return {element,tabBar,content};
  },
  handle() {
    const element=document.createElement('div');element.className='appui-workspace-handle';element.setAttribute('role','separator');return element;
  }
};
