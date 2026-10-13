"""Read retained input/output; do not execute a model or reinterpret rejected selections."""
from pathlib import Path
import gzip,json,hashlib
root=Path(__file__).resolve().parent;parent=root.parent/'flat-experiment'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
raw=json.loads(gzip.decompress((parent/'source.json.gz').read_bytes()))
inputs=json.loads((parent/'inputs.json').read_text());preflight=json.loads((parent/'token-preflight.json').read_text())
rows=[]
for row,prepared,sized in zip(raw['cases'],inputs['cases'],preflight['cases']):
 assert row['id']==prepared['id']==sized['id']
 assert row['messages']==prepared['messages'] and row['originalMessages']==prepared['originalMessages']
 actual_ids=row['calls'][0]['inputIds']
 assert hashlib.sha256(json.dumps(actual_ids,separators=(',',':')).encode()).hexdigest()==sized['inputIdsSha256']
 content=prepared['messages'][-1]['content'];catalog=json.loads(content.split('<reploid-literal-catalog-v1>\n')[1].split('\n</reploid-literal-catalog-v1>')[0]);facts={f['id']:f for f in catalog['entries']}
 selected=row['selection'];violations=[];used={}
 for fact_id in selected['base']:
  fact=facts[fact_id];doc=fact['source'].split(':')[0]
  if doc in used:violations.append({'kind':'multiple-base-in-document','document':doc,'facts':[used[doc],fact]})
  used[doc]=fact
 for fact_id in selected['depositBase']:
  fact=facts[fact_id]
  if fact['kind']!='money':violations.append({'kind':'wrong-deposit-base-unit','fact':fact})
 for relation in selected['relations']:
  kind,passage,fact_id=relation.split('|')
  if fact_id!='-' and facts.get(fact_id,{}).get('source')!=passage:
   violations.append({'kind':'fact-passage-mismatch','selection':relation,'actualFact':facts.get(fact_id)})
 rows.append({'id':row['id'],'exactExecutedInputIdsMatch':True,'promptTokens':len(actual_ids),
   'catalogFields':sorted(catalog['entries'][0]),'catalogIncludesQuote':any('quote' in f for f in facts.values()),
   'fullOriginalPassagesStillPresent':prepared['messages'][1:-1]==row['originalMessages'],
   'documentRoleSelections':sum(len(selected[k]) for k in ['base','additional','credits','includedAmounts','depositBase','depositPercent','start','duration','completion','relations']),
   'violations':violations,'structurallyComplete':row['complete'],'fullFactualAcceptance':False})
assert rows[0]['documentRoleSelections']==0
assert {v['kind'] for v in rows[1]['violations']}=={'multiple-base-in-document','wrong-deposit-base-unit','fact-passage-mismatch'}
report={'schema':'reploid.source-row-proposal-diagnosis/v1','modelExecuted':False,'sourceFiles':{name:sha(parent/name) for name in ['freeze.json','source.json.gz','inputs.json','token-preflight.json','review.json']},'cases':rows,'finding':'Observed semantic/alias selection failures with correctly delivered inputs. No tokenizer, template, truncation or serialization defect established. Inline source rows are a hypothesis, not a proven cause.'}
(root/'diagnosis.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'modelExecuted':False,'executedInputsVerified':len(rows),'secondCaseMechanicalViolations':len(rows[1]['violations'])}))
