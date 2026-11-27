/* Merge registered commands and menu actions for the shared command palette. */
window.AppUIShellPaletteRenderer={
  sync({palette,definitions,available,menuActions,runCommand,triggerMenu}) {
    const known=new Set(definitions.map(command=>command.id)),labels=new Map();
    for(const item of menuActions)if(!labels.has(item.id))labels.set(item.id,item);
    const commands=available.map(command=>{
      const item=labels.get(command.id);
      return {name:command.label || item?.label || command.id,category:command.category || item?.menu || 'Actions',shortcut:command.shortcut || item?.shortcut || '',action:()=>runCommand(command.id,{}, {type:'palette'})};
    });
    for(const item of menuActions){
      if(!item.id || known.has(item.id) || item.id.startsWith('_sub_'))continue;
      known.add(item.id);commands.push({name:item.label || item.id,category:item.menu || 'Actions',shortcut:item.shortcut || '',action:()=>triggerMenu(item.menu,item.id)});
    }
    palette.init({commands});palette.setCommands(commands);return commands;
  },
};
