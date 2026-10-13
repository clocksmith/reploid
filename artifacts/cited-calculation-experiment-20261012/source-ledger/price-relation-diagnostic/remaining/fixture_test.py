import hashlib,json,unittest
from pathlib import Path
root=Path(__file__).resolve().parent
class FrozenInputs(unittest.TestCase):
 def test_exact_remaining_and_history(self):
  fixture=json.loads((root/'input.json').read_text());parent=json.loads((root.parent/'composition-inputs.json').read_text())['cases'][0]
  self.assertEqual(fixture['occurrences'],parent['occurrences'][1:])
  for key in ['originalMessages','originalCriteria']:self.assertEqual(fixture[key],parent[key])
  suite=json.loads((root/'suite.json').read_text());old=json.loads((root.parent/'suite.json').read_text())
  for key in ['instruction','generation','enableThinking','modelId','sourceRevision','eosTokenIds']:self.assertEqual(suite[key],old[key])
  self.assertEqual(len(suite['cases']),6)
  for task,item in zip(suite['cases'],fixture['occurrences'],strict=True):
   self.assertEqual([{'role':'system','content':suite['instruction']}]+task['messages'],item['messages'])
  review=json.loads((root.parent/'first-result/review.json').read_text())
  self.assertEqual(fixture['firstAccounting'],review['accounting'])
  self.assertEqual(fixture['preflight']['aggregateMaximumChargedIncludingObservedFirst'],415+2474+6*64)
if __name__=='__main__':unittest.main()
