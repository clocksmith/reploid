import unittest
from protocol import parse_call

GOOD = '<tool_call>\n<function=Calculate>\n<parameter=operations>\n[{"id":"total","op":"add","args":["f000","f001"]}]\n</parameter>\n</function>\n</tool_call>'

class ProtocolTests(unittest.TestCase):
    def test_one_operations_parameter(self):
        self.assertEqual(parse_call(GOOD)['arguments'], {'operations': [{'id': 'total', 'op': 'add', 'args': ['f000', 'f001']}]})
    def test_no_repair_extra_fields_calls_or_suffix(self):
        for bad in [GOOD.replace('operations','facts'), GOOD + GOOD, GOOD + 'answer', GOOD.replace('Calculate','Other'), GOOD.replace('[{"id"','{"id"'), GOOD.replace('"total"','NaN'), GOOD.replace('"id":"total"','"id":"total","id":"other"'), GOOD.replace('</function>', '<parameter=facts>[]</parameter></function>')]:
            with self.subTest(bad=bad), self.assertRaises(ValueError): parse_call(bad)

if __name__ == '__main__': unittest.main()
