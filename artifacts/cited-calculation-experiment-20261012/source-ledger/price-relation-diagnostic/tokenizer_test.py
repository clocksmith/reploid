"""Artificial preferences must be able to select every relation, including wrong/unknown."""
import argparse,json,hashlib
from pathlib import Path
import numpy as np
from tokenizers import Tokenizer
from transformers import AutoTokenizer
from constraint_adapter import PriceConstraint
from contract import DEFINITIONS,parse
p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--out',required=True);args=p.parse_args()
t=Tokenizer.from_file(str(Path(args.source)/'tokenizer.json'));official=AutoTokenizer.from_pretrained(args.source,local_files_only=True,trust_remote_code=False)
controller=PriceConstraint(t,[151645,151643],official);size=max(t.get_vocab().values())+1;paths=[]
for label in DEFINITIONS:
 raw=json.dumps({'relation':label},separators=(',',':'));ids=t.encode(raw,add_special_tokens=False).ids+[151645];generated=[];row={};controller.arm()
 for desired in ids:
  logits=np.zeros(size,dtype=np.float32);logits[desired]=20
  selected=int(controller.mask(logits,generated,row).argmax());assert selected==desired;generated.append(selected)
 controller.finish(generated);assert parse(t.decode(generated[:-1],skip_special_tokens=False))==label
 assert len(ids)<=64 and all(s['rawWinnerAllowed'] for s in row['syntaxConstraint']['steps'])
 paths.append({'label':label,'tokens':len(ids),'allArtificialWinnersPreserved':True})
receipt={'schema':'reploid.single-price-tokenizer-control/v1','sourceModelExecuted':False,'passed':True,'paths':paths,'identity':controller.identity,'semanticAcceptance':False,'sourceTokenizerSha256':hashlib.sha256((Path(args.source)/'tokenizer.json').read_bytes()).hexdigest()}
Path(args.out).write_text(json.dumps(receipt,indent=2)+'\n')
