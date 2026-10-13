"""Synthetic logits and the installed tokenizer only; never load model weights."""
import argparse,hashlib,json,unittest
from pathlib import Path
import numpy as np
from tokenizers import Tokenizer
from transformers import AutoTokenizer
from constraint import SyntaxConstraint
from grammar_test import call
p=argparse.ArgumentParser();p.add_argument('--tokenizer',required=True);p.add_argument('--out',required=True);args=p.parse_args()
tokenizer=Tokenizer.from_file(args.tokenizer);official=AutoTokenizer.from_pretrained(str(Path(args.tokenizer).parent),local_files_only=True,trust_remote_code=False);constraint=SyntaxConstraint(tokenizer,[151645,151643],official);size=max(tokenizer.get_vocab().values())+1
schema=[{'function':{'name':'AnnotateSource','parameters':{'properties':{
 'factRoles':{'minItems':1,'maxItems':1,'items':{'maxItems':2,'items':{'enum':['red','blue']}}},
 'passageRelations':{'minItems':1,'maxItems':1,'items':{'maxItems':1,'items':{'enum':['left']}}},
}}}}]
records=[]
class ActualTokenizer(unittest.TestCase):
 def test_disabled_is_exact_identity(self):
  constraint.disable();scores=np.arange(size,dtype=np.float32);self.assertIs(constraint.mask(scores,[],{}),scores)
 def test_model_scores_choose_among_allowed_not_expected_tags(self):
  for roles in [[],['red'],['blue'],['blue','red']]:
   target=call([roles],[['left']]);ids=tokenizer.encode(target,add_special_tokens=False).ids+[151645]
   constraint.arm(schema);row={};generated=[]
   for desired in ids:
    scores=np.zeros(size,dtype=np.float32);scores[desired]=10
    masked=constraint.mask(scores,generated,row);chosen=int(masked.argmax());self.assertEqual(chosen,desired)
    self.assertEqual(masked[desired],scores[desired]);generated.append(chosen)
   constraint.finish(generated);self.assertEqual(tokenizer.decode(generated[:-1],skip_special_tokens=False),target)
   self.assertEqual(official.decode(generated[:-1],skip_special_tokens=False,clean_up_tokenization_spaces=False),target)
   records.append({'roles':roles,'tokens':len(generated),'maskSeconds':sum(s['maskSeconds'] for s in row['syntaxConstraint']['steps']),'officialDecodeWithoutCleanupMatches':True,'allRawWinnersPreserved':all(s['rawWinnerAllowed'] for s in row['syntaxConstraint']['steps'])})
 def test_early_eos_blocked_without_inserting_output(self):
  constraint.arm(schema);scores=np.zeros(size,dtype=np.float32);scores[151645]=100
  masked=constraint.mask(scores,[],{});self.assertTrue(np.isneginf(masked[151645]));self.assertNotEqual(int(masked.argmax()),151645)
 def test_nonadditive_candidate_is_rejected_before_sampling(self):
  class InaccurateStream:
   def decode(self,ids,**options):
    text=tokenizer.decode(ids,**options)
    return text+'X' if len(ids)>1 else text
  constraint.arm(schema);scores=np.zeros(size,dtype=np.float32)
  masked=constraint.mask(scores,[],{});first=int(masked.argmax())
  constraint.tokenizer=InaccurateStream()
  try:
   with self.assertRaisesRegex(ValueError,'full-stream decode'):constraint.mask(scores,[first],{})
  finally:constraint.tokenizer=tokenizer
 def test_prefix_desynchronization_rejected(self):
  constraint.arm(schema)
  with self.assertRaises(ValueError):constraint.mask(np.zeros(size,dtype=np.float32),[1,2],{})
result=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(ActualTokenizer))
Path(args.out).write_text(json.dumps({'schema':'reploid.syntax-tokenizer-control/v1','modelExecuted':False,'passed':result.wasSuccessful(),'tests':result.testsRun,'tokenizerSha256':hashlib.sha256(Path(args.tokenizer).read_bytes()).hexdigest(),'identity':constraint.identity,'syntheticPaths':records,'scope':'Artificial logits exercise arbitrary enums. They are not source-model behavior, factual evidence or a runtime throughput benchmark.'},indent=2)+'\n')
if not result.wasSuccessful():raise SystemExit(1)
