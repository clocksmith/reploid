import itertools,json,unittest
from grammar import RowGrammar,TokenTrie

def call(facts,passages):return '<tool_call>\n'+json.dumps({'name':'AnnotateSource','arguments':{'factRoles':facts,'passageRelations':passages}},separators=(',',':'))+'\n</tool_call>'
def accepted(grammar,text):
 state=grammar.advance(grammar.initial(),text)
 return state is not None and grammar.complete(state)

class ArbitraryGrammar(unittest.TestCase):
 def test_every_small_unrelated_legal_combination(self):
  grammar=RowGrammar(2,1,['red','blue'],['left'],2,1)
  groups=[[],['red'],['blue'],['red','blue'],['blue','red']]
  for a,b,c in itertools.product(groups,groups,[[],['left']]):self.assertTrue(accepted(grammar,call([a,b],[c])))
 def test_shape_enums_duplicates_limits_and_wrapper(self):
  grammar=RowGrammar(2,1,['red','blue'],['left'],1,1)
  invalid=[call([['red']],[[]]),call([[],[],[]],[[]]),call([[],[]],[]),call([['unknown'],[]],[[]]),
   call([['red','red'],[]],[[]]),call([['red','blue'],[]],[[]]),call([[],[]],[['left','left']]),
   call([[],[]],[[]])[:-1],call([[],[]],[[]])+'extra',call([[],[]],[[]]).replace('AnnotateSource','Other')]
  for text in invalid:self.assertFalse(accepted(grammar,text),text)
 def test_empty_tag_lists_remain_legal_no_forced_role(self):
  self.assertTrue(accepted(RowGrammar(3,2,['a','b'],['c']),call([[],[],[]],[[],[]])))
  self.assertTrue(accepted(RowGrammar(0,0,['a'],['b']),call([],[])))
 def test_escaped_enum_strings_and_shared_prefixes(self):
  tags=['a','ab','quote"here','back\\slash','\u03bb']
  grammar=RowGrammar(1,0,tags,['other'])
  for tag in tags:self.assertTrue(accepted(grammar,call([[tag]],[])))
 def test_token_trie_agrees_with_independent_whole_prefix_validation(self):
  grammar=RowGrammar(1,1,['red','blue'],['left']);full=call([['red','blue']],[['left']])
  strings=set(full)|{'red','blue','["','],[','red","blue',']}}\n</tool_call>','not allowed','🟥'}
  tokens={i:s for i,s in enumerate(sorted(strings))};trie=TokenTrie(tokens,[999])
  state=grammar.initial()
  for char in full:
   actual=trie.choices(grammar,state)
   expected={i for i,s in tokens.items() if s.isascii() and grammar.advance(state,s) is not None}
   self.assertEqual(set(actual),expected)
   self.assertNotIn(999,actual)
   state=grammar.advance(state,char)
  self.assertEqual(set(trie.choices(grammar,state)),{999})
 def test_vocabulary_does_not_force_canonical_tokenization(self):
  grammar=RowGrammar(0,0,['a'],['b']);full=call([],[])
  trie=TokenTrie({1:full,2:'<',3:'<tool_call>'},[9]);allowed=trie.choices(grammar,grammar.initial())
  self.assertEqual(set(allowed),{1,2,3})
  self.assertTrue(grammar.complete(allowed[1]))
 def test_semantic_type_contradictions_are_not_selected_or_masked(self):
  grammar=RowGrammar(1,1,['base','depositPercent','quantityFor:D7'],['included','excluded'])
  # Both are syntactically permitted. The unchanged downstream validator/reviewer decides meaning.
  self.assertTrue(accepted(grammar,call([['base','depositPercent']],[['included','excluded']])))
  self.assertTrue(accepted(grammar,call([[]],[[]])))
if __name__=='__main__':unittest.main()
