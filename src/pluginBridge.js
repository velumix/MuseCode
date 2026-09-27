addEventListener("message", function boot(e) {
  if (e.source !== parent || !e.ports[0]) return;
  removeEventListener("message", boot);
  const port = e.ports[0];
  const pluginURL = URL.createObjectURL(
    new Blob([e.data.source], { type: "text/javascript" }),
  );
  const bootstrap = `
    (async()=>{
    const send = postMessage.bind(self);
    const pending = new Map(); let seq = 0;
    const call = (method,args={}) => new Promise((resolve,reject)=>{
      const id=++seq; pending.set(id,{resolve,reject}); send({type:'call',id,method,args});
    });
    self.onmessage=e=>{
      const p=pending.get(e.data.id); if(!p)return; pending.delete(e.data.id);
      e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.value);
    };
    const api=Object.freeze({
      workspace:Object.freeze({readText:path=>call('workspace.readText',{path}),listFiles:(path='.')=>call('workspace.listFiles',{path})}),
      conversation:Object.freeze({messages:()=>call('conversation.messages')}),
      storage:Object.freeze({get:key=>call('storage.get',{key}),set:(key,value)=>call('storage.set',{key,value})})
    });
    try {
      importScripts(${JSON.stringify(pluginURL)});
      const plugin=self.VelumPlugin?.default || self.VelumPlugin;
      const command=plugin?.commands?.[${JSON.stringify(e.data.command)}];
      if(typeof command!=='function')throw new Error('The plugin does not implement this command.');
      const result=await command(api,${JSON.stringify(e.data.input)});
      send({type:'result',result});
    } catch(error) { send({type:'error',error:String(error).slice(0,1000)}); }
    })();
  `;
  const workerURL = URL.createObjectURL(
    new Blob([bootstrap], { type: "text/javascript" }),
  );
  const worker = new Worker(workerURL);
  worker.onmessage = (e) => port.postMessage(e.data);
  worker.onerror = (e) => {
    e.preventDefault();
    port.postMessage({
      type: "error",
      error: e.message || "Plugin worker failed.",
    });
  };
  port.onmessage = (e) => {
    if (e.data.stop) {
      worker.terminate();
      URL.revokeObjectURL(workerURL);
      URL.revokeObjectURL(pluginURL);
      port.close();
    } else worker.postMessage(e.data);
  };
  port.start();
});
