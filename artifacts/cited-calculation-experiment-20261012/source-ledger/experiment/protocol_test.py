import unittest,json,subprocess
from pathlib import Path
from protocol import parse_call,admission,charge,run_bridge,retain_boundary
from types import SimpleNamespace

class Contract(unittest.TestCase):
    def test_one_call(self):
        args={'budget':None,'deadline':None,'documents':[]}
        self.assertEqual(parse_call('<tool_call>'+json.dumps({'name':'SourceLedger','arguments':args})+'</tool_call>')['arguments'],args)
    def test_invalid_calls(self):
        valid='<tool_call>{"name":"SourceLedger","arguments":{"budget":null,"deadline":null,"documents":[]}}</tool_call>'
        for text in [valid+valid,'Answer first '+valid,valid+' trailing',valid.replace('SourceLedger','Calculate'),valid.replace('"budget":null','"budget":null,"budget":null'),valid.replace('"budget":null','"budget":NaN'),valid.replace('"documents":[]','"documents":[],"total":99')]:
            with self.assertRaises((ValueError,json.JSONDecodeError)):parse_call(text)
    def test_bridge_rejection_is_explicit(self):
        bridge=Path(__file__).with_name('bridge.js')
        result=subprocess.run(['node',str(bridge)],input=json.dumps({'selection':{'budget':None,'deadline':None,'documents':[]},'messages':[],'maxCharacters':100}),text=True,capture_output=True)
        self.assertEqual(result.returncode,0)
        response=json.loads(result.stdout)
        self.assertFalse(response['ok']);self.assertIn('error',response);self.assertNotIn('report',response)
    def test_bridge_failures_are_retained(self):
        failures=[
            ('bridge-timeout',subprocess.TimeoutExpired(['node'],10,output=b'partial',stderr=b'error')),
            ('bridge-infrastructure',RuntimeError('injected failure')),
            ('bridge-exit',SimpleNamespace(returncode=3,stdout='partial',stderr='failed')),
            ('bridge-invalid-json',SimpleNamespace(returncode=0,stdout='not json',stderr='')),
            ('bridge-invalid-envelope',SimpleNamespace(returncode=0,stdout='{"ok":true}',stderr='')),
        ]
        for category,observed in failures:
            def execute(*args,**kwargs):
                if isinstance(observed,Exception):raise observed
                return observed
            result=run_bridge('unused',{},execute)
            self.assertFalse(result['ok']);self.assertEqual(result['category'],category)
            self.assertIn('error',result)
            row={'id':'first','complete':False,'failure':result['error'],'toolResult':result}
            report={'cases':[row]};written=[]
            self.assertTrue(retain_boundary(report,row,[{'id':'first'},{'id':'later'}],lambda value:written.append(json.loads(json.dumps(value)))))
            self.assertEqual(written[0]['unrunCases'],['later'])
            self.assertEqual(written[0]['cases'][0]['toolResult']['category'],category)
            self.assertEqual(written[0]['status'],'stopped at structural boundary')
            self.assertTrue(written[0]['reviewRequired'])
        self.assertEqual(run_bridge('unused',{},lambda *a,**k:SimpleNamespace(returncode=0,stdout='{"ok":false,"error":"rejected"}',stderr=''))['error'],'rejected')
    def test_whole_work_charge(self):
        limits={'generatedTokens':4096,'promptPlusGeneratedTokens':8192,'rawOutputUtf16':16000}
        self.assertEqual(admission(limits,4247),3945)
        self.assertEqual(admission(limits,9000),0)
        self.assertFalse(charge(limits,8192,[1],'a')['withinBudgets'])
        self.assertFalse(charge(limits,3,[1],'a'*8000,'b'*8001)['withinBudgets'])
        self.assertEqual(charge(limits,3,[1],'😀','😀')['totalOutputUtf16'],4)

if __name__=='__main__':unittest.main()
