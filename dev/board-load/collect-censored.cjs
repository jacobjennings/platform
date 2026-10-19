'use strict'
// Run only inside the dedicated fixture runner. Records IDs before stopping
// this scenario's workers. Never searches or signals the host process namespace.
const fs = require('node:fs')
const path = require('node:path')
const folder = process.env.BOARD_LOAD_RESULTS || path.join(__dirname,'results')
const state = process.env.BOARD_LOAD_STATE || path.join(__dirname,'state')
if (process.env.BOARD_LOAD_RUNNER !== '1' || !fs.existsSync('/.dockerenv')) throw new Error('Dedicated Docker fixture runner required')
const scenario = process.argv[2]
if (scenario !== 'stall-separate') throw new Error('Only the known fixture scenario is supported')
const workers=[]
let driver
for (const entry of fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x))) {
  let args
  try { args=fs.readFileSync(`/proc/${entry}/cmdline`,'utf8').split('\0') } catch { continue }
  if (args[1]===path.join(__dirname,'driver.cjs') && args.includes(scenario)) driver=Number(entry)
  if (args[1]!==path.join(__dirname,'worker.cjs')) continue
  let options
  try { options=JSON.parse(args[2]) } catch { continue }
  if (options.separate===true && options.concurrency===16) workers.push({pid:Number(entry),options})
}
if (!driver || workers.length!==16) throw new Error('Owned scenario inventory did not match')
fs.writeFileSync(`${state}/censored-process-ids.json`,JSON.stringify({driver,workers},null,2))
for (const {pid,options} of workers) {
  const file=`${folder}/heartbeat-${pid}.json`
  const hello=JSON.parse(fs.readFileSync(`${folder}/separate-hellos.json`))[options.lane]
  const hasHeartbeat=fs.existsSync(file)
  const row=hasHeartbeat ? JSON.parse(fs.readFileSync(file)) : { operation:'prime-connect',lane:options.lane,
    elapsedMs:Date.now()-Date.parse(hello.at),http:{},rpc:{},model:[],hello:[],rateLimited:0,
    timingBasis:'Lower bound measured since server hello. Earlier login time excluded.',serverHelloMs:hello.serverHelloMs,countsUnavailable:true }
  fs.appendFileSync(`${folder}/${scenario}.jsonl`,JSON.stringify({run:scenario,at:new Date(hasHeartbeat ? fs.statSync(file).mtimeMs : Date.now()).toISOString(),
    operation:row.operation,lane:options.lane,concurrency:16,ms:row.elapsedMs,ok:false,censored:true,
    error:'Stopped after sustained zero-rate-limit stall with exhausted SQL pool. Duration is a measured lower bound.',
    ...Object.fromEntries(Object.entries(row).filter(([k])=>!['operation','lane','elapsedMs'].includes(k)))})+'\n')
}
for (const {pid} of workers) process.kill(pid,'SIGTERM')
process.kill(driver,'SIGTERM')
fs.writeFileSync(`${folder}/phase`,'idle')
console.log('Recorded 16 censored probes and stopped their recorded owned processes')
