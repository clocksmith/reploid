import unittest
from protocol import parse_call, response_messages
class Tests(unittest.TestCase):
    def test_exact_official_json(self):
        raw='<tool_call>\n{"name":"Calculate","arguments":{"money":[],"dates":[]}}\n</tool_call>'
        self.assertEqual(parse_call(raw)['arguments'],{'money':[],'dates':[]})
        history=[{'role':'user','content':'unchanged'}];error={'ok':False,'error':'actual error'}
        updated=response_messages(history,raw,error)
        self.assertEqual(updated[:-2],history);self.assertEqual(updated[-2]['content'],raw)
        self.assertIn('actual error',updated[-1]['content'])
    def test_reject_wrong_protocol_and_repairs(self):
        for raw in ['<tool_call><function=Calculate><parameter=money>[]</parameter></function></tool_call>',
          '<tool_call>{"name":"Calculate","name":"Calculate","arguments":{"money":[],"dates":[]}}</tool_call>',
          '<tool_call>{"name":"Other","arguments":{"money":[],"dates":[]}}</tool_call>',
          '<tool_call>{"name":"Calculate","arguments":{"money":[],"dates":NaN}}</tool_call>',
          '<tool_call>{"name":"Calculate","arguments":{"money":[]}}</tool_call>',
          '<tool_call>{"name":"Calculate","arguments":{"money":[],"dates":[]}}</tool_call>extra',
          '<tool_call>{"name":"Calculate"}']:
            with self.assertRaises(ValueError):parse_call(raw)
if __name__=='__main__':unittest.main()
