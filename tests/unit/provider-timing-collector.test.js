import {expect,it} from 'vitest';
import {createProviderTimingCollector} from '../fixtures/provider-timing-collector.js';
it('bounds records and retains only finite timings and correlation identifiers',()=>{
 const c=createProviderTimingCollector({maxRecords:2});
 const m={operation:'step',identity:{attemptId:'a',prompt:'secret'},step:0,partitionIndex:1,tokens:[123],grant:'secret'};
 c.observe({totalMs:3,serveMs:NaN,authorizationMs:-1,extra:'secret'},m);m.identity.attemptId='changed';
 c.observe({totalMs:4},m);c.observe({totalMs:5},m);
 expect(c.receipt.records).toEqual([{totalMs:3,operation:'step',attemptId:'a',partitionIndex:1,step:0},
 {totalMs:4,operation:'step',attemptId:'changed',partitionIndex:1,step:0}]);
 expect(c.receipt.dropped).toBe(1);expect(JSON.stringify(c.receipt)).not.toContain('secret');
});
it('bounds strings and rejects unbounded configuration',()=>{
 const c=createProviderTimingCollector();c.observe({}, {operation:'x'.repeat(1000),identity:{attemptId:'a'.repeat(1000)}});
 expect(c.receipt.records[0].operation.length).toBe(64);expect(c.receipt.records[0].attemptId.length).toBe(256);
 for(const maxRecords of [0,-1,2049,Infinity,1.5])expect(()=>createProviderTimingCollector({maxRecords})).toThrow();
});
