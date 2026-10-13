"""Replay frozen grammar against retained tokens; no model or new generation."""
import argparse,hashlib,json,sys,dataclasses
from pathlib import Path
from tokenizers import Tokenizer
from transformers import AutoTokenizer
p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--source',required=True);p.add_argument('--result',required=True);p.add_argument('--out',required=True);args=p.parse_args()
sys.path.insert(0,args.root)
from constraint_adapter import PriceConstraint
from contract import DEFINITIONS
q=Tokenizer.from_file(str(Path(args.source)/'tokenizer.json'));official=AutoTokenizer.from_pretrained(args.source,local_files_only=True,trust_remote_code=False)
c=PriceConstraint(q,[151645,151643],official);r=json.loads(Path(args.result).read_text());rows=[]
sha=lambda x:hashlib.sha256(json.dumps(x,separators=(',',':')).encode()).hexdigest()
for call in r['calls']:
 c.arm();steps=[];ids=call['result']['tokenIds'];first=None
 for trace in call['result']['syntaxConstraint']['steps']:
  choices=c.trie.choices(c.grammar,c.state)
  assert len(choices)==trace['allowedCount'] and sha(sorted(choices))==trace['allowedIdsSha256']
  prefix=c.state.prefix;labels=[label for label in DEFINITIONS if json.dumps({'relation':label},separators=(',',':')).startswith(prefix)]
  next_state=choices[trace['selectedToken']];next_labels=[label for label in labels if json.dumps({'relation':label},separators=(',',':')).startswith(next_state.prefix)]
  allowed_texts={str(token):q.decode([token],skip_special_tokens=False) for token in choices}
  row={**trace,'prefix':prefix,'rawWinnerText':q.decode([trace['rawWinner']],skip_special_tokens=False),'selectedText':q.decode([trace['selectedToken']],skip_special_tokens=False),'remainingLabelsBefore':labels,'remainingLabelsAfter':next_labels,'allowedTexts':allowed_texts}
  if first is None and len(next_labels)<len(labels):first=row
  steps.append(row);c.state=next_state
 rows.append({'id':call['id'],'sourceOccurrence':call['sourceOccurrence'],'selectedRelation':call['selectedRelation'],'firstLabelDistinguishingStep':first,'maskedSteps':[x for x in steps if not x['rawWinnerAllowed']],'allSteps':steps})
Path(args.out).write_text(json.dumps({'schema':'reploid.price-relation-token-audit/v1','sourceModelExecuted':False,'newGenerationCalls':0,'allAllowedIdHashesReproduced':True,'results':rows,'limitation':'Raw winner logits are retained. Scores for unselected alternative labels are not retained. Semantic decisions are conditioned on earlier syntax masking; this audit is not an unconstrained counterfactual.'},indent=2)+'\n')
