'use strict'
// Read-only debugger inspection of this fixture's transactor after a stall.
// Run inside its container after explicitly enabling its localhost inspector.
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const folder = process.env.PROFILE_DIR || process.env.BOARD_LOAD_RESULTS || path.join(__dirname, 'results')
const state = process.env.BOARD_LOAD_STATE || path.join(__dirname, 'state')
async function main() {
  const api = require(`${root}/foundations/core/packages/api-client/lib`)
  const { agent } = JSON.parse(fs.readFileSync(`${state}/account-16.json`))
  const login = await api.getWorkspaceToken('http://config:8080', { ...agent, workspace: 'hulyaccessevaluation' })
  const targets = await (await fetch('http://127.0.0.1:9229/json/list')).json()
  const debuggerSocket = new WebSocket(targets[0].webSocketDebuggerUrl)
  await new Promise((resolve,reject) => { debuggerSocket.onopen=resolve; debuggerSocket.onerror=reject })
  const pending = new Map()
  let sequence = 0, pauseResolve
  const paused = new Promise(resolve => { pauseResolve=resolve })
  debuggerSocket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.id) { const item=pending.get(message.id); pending.delete(message.id); message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result) }
    else if (message.method === 'Debugger.paused') pauseResolve(message.params)
  }
  const cdp = (method,params={}) => new Promise((resolve,reject) => {
    const id=++sequence; pending.set(id,{resolve,reject}); debuggerSocket.send(JSON.stringify({id,method,params}))
  })
  await cdp('Debugger.enable')
  const lines=fs.readFileSync(`${root}/pods/server/bundle/bundle.js`,'utf8').split('\n')
  const line=lines.findIndex(value=>value.includes('async retry(id, mgrId, fn)'))
  if (line<0) throw new Error('ConnectionMgr retry entry not found')
  const breakpoint=await cdp('Debugger.setBreakpointByUrl',{urlRegex:'bundle\\.js$',lineNumber:line+1})
  const socket=new WebSocket(`${login.endpoint}/${login.token}?sessionId=local-profile-pool`)
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject})
  socket.onmessage=async event=>{
    const message=JSON.parse(typeof event.data==='string'?event.data:await event.data.text())
    if (message.id===-1) socket.send(JSON.stringify({id:1,method:'findAll',params:['tracker:class:Project',{_id:'local-profile-pool-missing'},{limit:1,showArchived:true}]}))
  }
  socket.send(JSON.stringify({id:-1,method:'hello',params:[],binary:false,compression:false}))
  const frame=await Promise.race([paused,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Debugger breakpoint deadline')),15000))])
  const details=await cdp('Debugger.evaluateOnCallFrame',{callFrameId:frame.callFrames[0].callFrameId,returnByValue:true,
    expression:'JSON.stringify({entries:Array.from(this.connections.entries()).map(([id,c])=>({id,managed:c.managed,released:c.released,available:c.available.length,mgrId:c.mgrId}))})'})
  fs.writeFileSync(`${folder}/blocked-pool.json`,JSON.stringify({at:new Date().toISOString(),frames:frame.callFrames.map(f=>({name:f.functionName,location:f.location})),pool:JSON.parse(details.result.value)},null,2))
  await cdp('Debugger.removeBreakpoint',{breakpointId:breakpoint.breakpointId})
  await cdp('Debugger.resume')
  socket.close(); debuggerSocket.close()
  console.log('Saved read-only pool inspection')
}
const timer=setTimeout(()=>process.exit(124),30000)
main().then(()=>{clearTimeout(timer);process.exit(0)}).catch(error=>{console.error(error.message);clearTimeout(timer);process.exit(1)})
