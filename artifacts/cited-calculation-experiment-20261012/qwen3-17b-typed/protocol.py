"""Strict original Qwen3 JSON tool framing. No XML argument conversion or repair."""
import json
import re


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON object key')
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError('Non-JSON constant: ' + value)


def parse_call(text):
    if not isinstance(text, str) or len(text.encode('utf-16-le')) // 2 > 16000:
        raise ValueError('Tool output exceeds allowance')
    start = text.find('<tool_call>')
    if start < 0 or text.count('<tool_call>') != 1:
        raise ValueError('Expected exactly one official tool call')
    match = re.fullmatch(r'<tool_call>\s*(.*?)\s*</tool_call>\s*', text[start:], re.S)
    if not match:
        raise ValueError('Malformed official tool wrapper')
    call = json.loads(match[1], object_pairs_hook=unique_object, parse_constant=reject_constant)
    if not isinstance(call, dict) or set(call) != {'name', 'arguments'} or call['name'] != 'Calculate':
        raise ValueError('Required Calculate name and arguments only')
    args = call['arguments']
    if not isinstance(args, dict) or set(args) != {'money', 'dates'} or not all(isinstance(args[key], list) for key in args):
        raise ValueError('Both money and dates array arguments are required')
    return {**call, 'preamble': text[:start]}


def response_messages(original, raw_call, result):
    return [*original, {'role': 'assistant', 'content': raw_call}, {'role': 'tool', 'content': json.dumps(result)}]
