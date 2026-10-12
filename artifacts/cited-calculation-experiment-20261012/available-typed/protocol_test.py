import json
import unittest
from protocol import parse_call, response_messages

def raw(args):return '<tool_call>'+json.dumps({'name':'Calculate','arguments':args})+'</tool_call>'
class Tests(unittest.TestCase):
    def test_declared_families(self):
        for families in [['money'],['dates'],['money','dates']]:
            args={name:[] for name in families};self.assertEqual(parse_call(raw(args),families)['arguments'],args)
        for args,families in [({'money':[],'dates':[]},['money']),({'money':[]},['dates']),({},[]),({'money':{}},['money'])]:
            with self.assertRaises(ValueError):parse_call(raw(args),families)
    def test_no_repair(self):
        invalid='<tool_call>{"name":"Calculate","arguments":{"money":[],"money":[]}}</tool_call>'
        with self.assertRaises(ValueError):parse_call(invalid,['money'])
        with self.assertRaises(ValueError):parse_call(raw({'money':[]})+'extra',['money'])
        history=[{'role':'user','content':'same'}];out=response_messages(history,invalid,{'ok':False,'error':'Duplicate JSON object key'})
        self.assertEqual(out[0],history[0]);self.assertEqual(out[1]['content'],invalid)
if __name__=='__main__':unittest.main()
