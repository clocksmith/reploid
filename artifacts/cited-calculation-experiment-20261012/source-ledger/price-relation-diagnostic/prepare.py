"""Project already-validated source rows; no model output is consulted."""
from pathlib import Path
import json,hashlib
from contract import DEFINITIONS,bind_occurrence,messages
root=Path(__file__).resolve().parent;parent=root.parent/'row-tag-experiment'
inputs=json.loads((parent/'inputs.json').read_text());suite=json.loads((parent/'suite.json').read_text())
controls=[]
for task,original in zip(inputs['cases'],suite['cases'],strict=True):
 assert task['id']==original['id'] and task['originalMessages']==original['messages']
 rows=json.loads(task['selectionMessages'][-1]['content'].split('<source-rows-v1>\n')[1].split('\n</source-rows-v1>')[0])
 passages={p['id']:p['text'] for p in rows['passages']};questions=[]
 for message in original['messages']:
  if message['role']!='user':continue
  content=message['content'];marker='\n<reploid-document-sources-v1>\n'
  questions.append(content.split(marker)[0] if marker in content else content)
 occurrences=[];counts={}
 for index,fact in enumerate(rows['facts']):
  if fact['kind']!='money' or fact['source'] not in passages:continue
  key=(fact['source'],fact['value']);number=counts.get(key,0);counts[key]=number+1
  occurrence=bind_occurrence(fact['source'],passages[fact['source']],fact['value'],number)
  occurrences.append({'rowIndex':index,'occurrence':occurrence,'messages':messages(questions,occurrence)})
 controls.append({'id':task['id'],'questionContext':questions,'originalMessages':original['messages'],'originalCriteria':original['reviewCriteria'],'occurrences':occurrences})
first=controls[0];chosen=first['occurrences'][0]
assert first['id']=='fresh-bathroom-comparison' and chosen['rowIndex']==2
fixture={'schema':'reploid.single-price-relation-input/v1','selectionRule':'First document monetary occurrence in first original case, in the retained source row order; not selected from model outcomes.',
 'caseId':first['id'],'rowIndex':chosen['rowIndex'],'occurrence':chosen['occurrence'],'messages':chosen['messages'],
 'originalMessages':first['originalMessages'],'originalCriteria':first['originalCriteria'],
 'definitions':DEFINITIONS,'expectedOutputShape':{'relation':'one of the seven globally admitted labels; no label preselected'},
 'reviewOnlyNotInPrompt':{'supportedRelation':'quoted_total','reason':'This occurrence states the offered bathroom work price including installation and disposal. It is not the distinct occurrence inside the deposit passage. A correct label does not qualify costs, conditions, citations or a complete answer.'},
 'generation':{**suite['generation'],'maxTokens':64},'enableThinking':suite['enableThinking'],'eosTokenIds':suite['eosTokenIds'],
 'aggregateBudgets':suite['aggregateBudgets'],'scope':'One diagnostic call only. No arithmetic, followup, final answer or automatic next occurrence.'}
(root/'input.json').write_text(json.dumps(fixture,indent=2)+'\n')
(root/'composition-inputs.json').write_text(json.dumps({'schema':'reploid.price-relation-composition-inputs/v1','scope':'Tokenizer-only cost controls, not a scheduled model batch or semantic selections. Final answer/control remains original ordered history. Nonmonetary interpretation and conditions remain unimplemented/unqualified.','cases':controls},indent=2)+'\n')
print(hashlib.sha256((root/'input.json').read_bytes()).hexdigest())
