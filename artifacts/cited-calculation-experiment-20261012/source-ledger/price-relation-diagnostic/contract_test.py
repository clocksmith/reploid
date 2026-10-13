import json,unittest
from contract import DEFINITIONS,RelationGrammar,bind_occurrence,messages,parse
class Contract(unittest.TestCase):
 def test_every_label_available_without_any_source_specific_mask(self):
  grammar=RelationGrammar()
  for label in DEFINITIONS:
   text=json.dumps({'relation':label},separators=(',',':'));state=grammar.advance(grammar.initial(),text)
   self.assertTrue(grammar.complete(state));self.assertEqual(parse(text),label)
 def test_unknown_and_escaped_arbitrary_labels(self):
  grammar=RelationGrammar(['red','redder','a"b','é'])
  for text in grammar.outputs:self.assertTrue(grammar.complete(grammar.advance(grammar.initial(),text)))
 def test_partial_or_extra_syntax_rejected(self):
  grammar=RelationGrammar()
  for text in ['{"relation":"base"}','{"relation":"quoted_total","why":"yes"}','["quoted_total"]']:
   self.assertIsNone(grammar.advance(grammar.initial(),text))
   with self.assertRaises((ValueError,TypeError)):parse(text)
  with self.assertRaises(ValueError):parse('{"relation":"unknown","relation":"quoted_total"}')
 def test_exact_second_occurrence_is_distinct(self):
  passage='A quoted sum is $73. The deposit uses $73 as its percentage basis.'
  first=bind_occurrence('X1:P4',passage,'$73',0);second=bind_occurrence('X1:P4',passage,'$73',1)
  self.assertNotEqual(first['start'],second['start']);self.assertEqual(first['passage'],second['passage'])
 def test_absent_partial_or_changed_binding_rejected(self):
  with self.assertRaises(ValueError):bind_occurrence('X1:P1','Quoted $730.',' $73')
  with self.assertRaises(ValueError):bind_occurrence('X1:P1','Quoted $730.','$73')
  with self.assertRaises(ValueError):bind_occurrence('X1:P1','Quoted $73.','$73',1)
  value=bind_occurrence('X1:P1','Quoted $73 today.','$73');value['end']+=1
  with self.assertRaises(ValueError):messages([],value)
 def test_prompt_has_only_exact_context_and_occurrence_not_expected_label(self):
  value=bind_occurrence('X1:P2','The allowance is $29 within the quoted amount.','$29')
  prompt=messages(['Compare sources.'],value);payload=json.loads(prompt[1]['content'])
  self.assertEqual(payload,{'questionContext':['Compare sources.'],'quotedOccurrence':value})
  self.assertNotIn('expected',prompt[1]['content']);self.assertEqual(len(prompt),2)
if __name__=='__main__':unittest.main()
