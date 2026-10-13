import copy,json,unittest
from pathlib import Path
root=Path(__file__).resolve().parent
class MatchedInputs(unittest.TestCase):
 def test_only_question_context_changes(self):
  f=json.loads((root/'input.json').read_text());suite=json.loads((root/'suite.json').read_text());old=json.loads((root.parent/'suite.json').read_text())
  for key in ['modelId','sourceRevision','generation','instruction','enableThinking','eosTokenIds']:self.assertEqual(suite[key],old[key])
  self.assertEqual(len(f['pairs']),9);self.assertEqual(len(suite['cases']),18)
  for index,pair in enumerate(f['pairs']):
   control,treatment=pair['arms'];self.assertEqual(control['messages'][0],treatment['messages'][0])
   a=json.loads(control['messages'][1]['content']);b=json.loads(treatment['messages'][1]['content'])
   self.assertEqual(a.pop('questionContext'),[f['globalQuestion']]);self.assertEqual(b.pop('questionContext'),[]);self.assertEqual(a,b)
   for arm in pair['arms']:self.assertEqual(arm['messages'][1:],suite['cases'][2*index+pair['arms'].index(arm)]['messages'])
 def test_budget_and_no_expected_answers(self):
  pre=json.loads((root/'token-preflight.json').read_text());suite=json.loads((root/'suite.json').read_text());criteria=json.loads((root/'review-criteria.json').read_text())
  self.assertEqual(pre['aggregate']['maximumCharged'],7655);self.assertLessEqual(pre['aggregate']['maximumCharged'],8192)
  self.assertEqual(pre['aggregate']['maximumGenerated'],18*64)
  self.assertEqual(len({r['requiredRelation'] for r in criteria['rows']}),7)
  for task in suite['cases']:
   self.assertNotIn('requiredRelation',json.dumps(task));self.assertNotIn('expected',task)
if __name__=='__main__':unittest.main()
