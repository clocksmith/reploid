"""Strict parser for the retained official checkpoint's one-call tool format."""
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
    opening = '<tool_call>'
    start = text.find(opening)
    if start < 0 or text.count(opening) != 1:
        raise ValueError('Expected exactly one official tool call')
    # Official template permits reasoning before, never after, the call.
    preamble = text[:start]
    body = text[start:]
    match = re.fullmatch(r'<tool_call>\s*<function=Calculate>\s*(.*?)\s*</function>\s*</tool_call>\s*', body, re.S)
    if not match:
        raise ValueError('Unknown function or malformed official tool wrapper')
    parameters = match[1]
    values = {}
    while parameters.strip():
        parameter = re.match(r'\s*<parameter=(operations)>\s*(.*?)\s*</parameter>', parameters, re.S)
        if not parameter or parameter[1] in values:
            raise ValueError('Missing, unknown, duplicate or malformed tool parameter')
        value = json.loads(parameter[2], object_pairs_hook=unique_object, parse_constant=reject_constant)
        if not isinstance(value, list):
            raise ValueError('Tool parameters require JSON arrays')
        values[parameter[1]] = value
        parameters = parameters[parameter.end():]
    if set(values) != {'operations'}:
        raise ValueError('The required operations parameter must be present')
    return {'name': 'Calculate', 'arguments': values, 'preamble': preamble}


def response_messages(original, raw_call, result):
    """Keep exact generated tool text; do not rewrite malformed output into a call."""
    return [*original,
            {'role': 'assistant', 'content': raw_call},
            {'role': 'tool', 'content': json.dumps(result)}]
