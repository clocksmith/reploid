import unittest
from protocol import parse_call, response_messages


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.text = '<tool_call>\n<function=Calculate>\n<parameter=facts>\n[]\n</parameter>\n<parameter=operations>\n[]\n</parameter>\n</function>\n</tool_call>'

    def test_exact_native_shape(self):
        call = parse_call(self.text)
        self.assertEqual(call['arguments'], {'facts': [], 'operations': []})
        self.assertEqual(call['name'], 'Calculate')

    def test_official_optional_preamble(self):
        self.assertEqual(parse_call('Inspecting quoted operands.\n' + self.text)['preamble'], 'Inspecting quoted operands.\n')

    def test_rejects_malformed_or_additional_calls(self):
        for text in [self.text + 'Done.', self.text * 2, self.text.replace('Calculate', 'Shell'),
                     self.text.replace('<parameter=operations>', '<parameter=facts>'),
                     self.text.replace('<parameter=operations>', '<parameter=other>'),
                     self.text.replace('[]', '{}', 1), '{"facts":[],"operations":[]}',
                     self.text.replace('[]', '[NaN]', 1),
                     self.text.replace('[]', '[{"id":"a","id":"b"}]', 1),
                     self.text.replace('<parameter=operations>\n[]\n</parameter>', '')]:
            with self.subTest(text=text), self.assertRaises(ValueError):
                parse_call(text)

    def test_preserves_original_and_raw_model_output(self):
        original = [{'role': 'user', 'content': 'Question'}, {'role': 'assistant', 'content': 'Prior wrong claim'}, {'role': 'user', 'content': 'Correct it'}]
        result = {'ok': False, 'error': 'rejected'}
        messages = response_messages(original, self.text, result)
        self.assertEqual(messages[:3], original)
        self.assertEqual(messages[3], {'role': 'assistant', 'content': self.text})
        self.assertEqual(messages[4]['role'], 'tool')
        self.assertEqual(original[-1]['content'], 'Correct it')


if __name__ == '__main__':
    unittest.main()
