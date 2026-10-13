import unittest,json,subprocess
from pathlib import Path
from protocol import parse_call,run_bridge,retain_boundary,answer_messages,allowance,accumulate
class Contract(unittest.TestCase):
 def test_strict_parser(self):
  args={'factRoles':[[]],'passageRelations':[[]]};valid='<tool_call>'+json.dumps({'name':'AnnotateSource','arguments':args},separators=(',',':'))+'</tool_call>'
  self.assertEqual(parse_call(valid)['arguments'],args)
  for text in [valid+valid,'explanation'+valid,valid.replace('AnnotateSource','Other'),valid.replace('"factRoles":','"extra":3,"factRoles":'),valid.replace('"factRoles":','"factRoles":[],"factRoles":'),valid.replace('[[]]','NaN')]:
   with self.assertRaises(ValueError):parse_call(text)
 def test_exact_history_and_tool_content(self):
  original=[{'role':'user','content':'source'},{'role':'assistant','content':'wrong earlier claim'},{'role':'user','content':'correct it'}]
  result={'value':'not independently qualified'};messages=answer_messages(original,'system','rawcall',result)
  self.assertEqual(messages[1:-2],original);self.assertIsNot(messages[1],original[0])
  self.assertEqual(messages[-2],{'role':'assistant','content':'rawcall'})
  self.assertEqual(json.loads(messages[-1]['content']),{'ok':True,'result':result})
 def test_two_calls_and_all_raw_bytes_charged(self):
  limits={'generatedTokens':4096,'promptPlusGeneratedTokens':8192,'rawOutputUtf16':16000}
  row={'promptTokens':0,'generatedTokens':0,'rawOutputUtf16':0}
  self.assertEqual(allowance(limits,row,3300,'selection'),1024)
  accumulate(limits,row,3300,list(range(1000)),'source')
  self.assertEqual(allowance(limits,row,3800,'answer'),92)
  accumulate(limits,row,3800,list(range(93)),'answer')
  self.assertFalse(row['withinBudgets']);self.assertEqual(row['totalChargedTokens'],8193)
  self.assertEqual(allowance(limits,row,10,'answer'),0)
  row={'promptTokens':0,'generatedTokens':0,'rawOutputUtf16':15999}
  accumulate(limits,row,1,[1],'😀');self.assertFalse(row['withinBudgets'])
 def test_bridge_failure_retained_and_no_final_answer(self):
  def failure(*a,**k):raise subprocess.TimeoutExpired(['node'],10,output=b'partial')
  response=run_bridge('unused',{},failure);self.assertFalse(response['ok'])
  row={'id':'first','complete':False,'failure':response['error'],'toolResult':response};report={'cases':[row]};saved=[]
  self.assertTrue(retain_boundary(report,row,[{'id':'first'},{'id':'later'}],lambda value:saved.append(value)))
  self.assertEqual(saved[0]['unrunCases'],['later']);self.assertNotIn('answerText',row)
 def test_real_bridge_rejects_no_sources(self):
  result=run_bridge(Path(__file__).with_name('bridge.js'),{'selection':{'factRoles':[],'passageRelations':[]},'messages':[]})
  self.assertFalse(result['ok']);self.assertIn('error',result)
if __name__=='__main__':unittest.main()
