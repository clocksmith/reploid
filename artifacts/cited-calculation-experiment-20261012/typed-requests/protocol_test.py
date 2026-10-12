import unittest
from protocol import parse_call, response_messages
class ProtocolTests(unittest.TestCase):
    def test_exact_arrays(self):
        text='<tool_call><function=Calculate><parameter=money>[]</parameter><parameter=dates>[]</parameter></function></tool_call>'
        self.assertEqual(parse_call(text)['arguments'],{'money':[],'dates':[]})
        history=[{'role':'user','content':'unchanged'}]
        failure={'ok':False,'error':'Operand has kind date; required money'}
        out=response_messages(history,text,failure)
        self.assertEqual(out[:-2],history);self.assertEqual(out[-2]['content'],text)
        self.assertIn(failure['error'],out[-1]['content'])
    def test_no_repair(self):
        for params in ['<parameter=money>[]</parameter>', '<parameter=money>[]</parameter><parameter=money>[]</parameter><parameter=dates>[]</parameter>', '<parameter=money>{}</parameter><parameter=dates>[]</parameter>', '<parameter=operations>[]</parameter>']:
            with self.assertRaises(ValueError):parse_call('<tool_call><function=Calculate>'+params+'</function></tool_call>')
        with self.assertRaises(ValueError):parse_call('<tool_call><function=Calculate><parameter=money>[]')
if __name__=='__main__':unittest.main()
