// Opt-in private benchmark diagnostics. Never retain prompt, tokens, grants or route.
const FIELDS=['requestId','admissionMs','payloadArrivalMs','readyToExecuteWaitMs','receiveToExecuteMs',
  'preServeAuthorizationMs','serveMs','responseAuthorizationMs','responsePreparationMs','replyQueueAndEnqueueMs','totalMs'];
export function createProviderTimingCollector({maxRecords=2048}={}) {
  if(!Number.isSafeInteger(maxRecords)||maxRecords<1||maxRecords>2048)throw Error('Invalid timing record bound');
  const receipt={schema:'reploid.provider-timing/v1',clock:'provider-local-monotonic',maxRecords,dropped:0,records:[]};
  return {receipt,observe(timing,metadata){
    if(receipt.records.length===maxRecords){receipt.dropped++;return;}
    const record={};
    for(const key of FIELDS)if(Number.isFinite(timing?.[key])&&timing[key]>=0)record[key]=timing[key];
    if(typeof metadata?.operation==='string')record.operation=metadata.operation.slice(0,64);
    if(typeof metadata?.identity?.attemptId==='string')record.attemptId=metadata.identity.attemptId.slice(0,256);
    for(const key of ['partitionIndex','step'])if(Number.isSafeInteger(metadata?.[key])&&metadata[key]>=0)record[key]=metadata[key];
    receipt.records.push(record);
  }};
}
