/// JSON text exactly as the JavaScript runtime writes it, because signatures
/// and digests in the requester contract are taken over these bytes.
///
/// `canonicalJson` sorts object keys by UTF-16 code units (procedure
/// `canonicalJson` of the requester contract). `jsJson` keeps insertion
/// order, as `JSON.stringify` does.
library;

String canonicalJson(Object? value) => _write(value, sortKeys: true);

String jsJson(Object? value) => _write(value, sortKeys: false);

String _write(Object? value, {required bool sortKeys}) {
  final out = StringBuffer();
  _encode(value, out, sortKeys, <Object>{});
  return out.toString();
}

void _encode(Object? value, StringBuffer out, bool sortKeys, Set<Object> open) {
  switch (value) {
    case null:
      out.write('null');
    case bool():
      out.write(value ? 'true' : 'false');
    case String():
      _string(value, out);
    case num():
      out.write(_number(value));
    case List<Object?>():
      if (!open.add(value)) throw ArgumentError('Canonical JSON has a cycle');
      out.write('[');
      for (var i = 0; i < value.length; i++) {
        if (i > 0) out.write(',');
        _encode(value[i], out, sortKeys, open);
      }
      out.write(']');
      open.remove(value);
    case Map<Object?, Object?>():
      if (!open.add(value)) throw ArgumentError('Canonical JSON has a cycle');
      final keys = [
        for (final key in value.keys)
          if (key is String)
            key
          else
            throw ArgumentError('Canonical JSON needs string keys'),
      ];
      if (sortKeys) keys.sort(_utf16);
      out.write('{');
      for (var i = 0; i < keys.length; i++) {
        if (i > 0) out.write(',');
        _string(keys[i], out);
        out.write(':');
        _encode(value[keys[i]], out, sortKeys, open);
      }
      out.write('}');
      open.remove(value);
    default:
      throw ArgumentError('Canonical JSON requires JSON values');
  }
}

/// Dart strings are UTF-16, so comparing code units matches `Array.sort`.
int _utf16(String a, String b) {
  final shared = a.length < b.length ? a.length : b.length;
  for (var i = 0; i < shared; i++) {
    final difference = a.codeUnitAt(i) - b.codeUnitAt(i);
    if (difference != 0) return difference;
  }
  return a.length - b.length;
}

const _maxSafeInteger = 9007199254740992; // 2^53

String _number(num value) {
  if (value is int) {
    // JavaScript holds every number as a double; beyond 2^53 it has already
    // rounded, so print the double it would hold.
    if (value.abs() <= _maxSafeInteger) return value.toString();
    return _double(value.toDouble());
  }
  return _double(value as double);
}

String _double(double value) {
  if (value.isNaN || value.isInfinite) return 'null';
  if (value == 0) return '0'; // also negative zero
  final text = value.toString(); // same shortest form as ECMAScript
  return text.endsWith('.0') ? text.substring(0, text.length - 2) : text;
}

void _string(String value, StringBuffer out) {
  out.write('"');
  for (var i = 0; i < value.length; i++) {
    final unit = value.codeUnitAt(i);
    switch (unit) {
      case 0x22:
        out.write(r'\"');
      case 0x5c:
        out.write(r'\\');
      case 0x08:
        out.write(r'\b');
      case 0x0c:
        out.write(r'\f');
      case 0x0a:
        out.write(r'\n');
      case 0x0d:
        out.write(r'\r');
      case 0x09:
        out.write(r'\t');
      default:
        if (unit < 0x20) {
          _escape(unit, out);
        } else if (unit >= 0xd800 && unit <= 0xdbff) {
          final next = i + 1 < value.length ? value.codeUnitAt(i + 1) : 0;
          if (next >= 0xdc00 && next <= 0xdfff) {
            out.writeCharCode(unit);
            out.writeCharCode(next);
            i++;
          } else {
            _escape(unit, out); // lone lead surrogate
          }
        } else if (unit >= 0xdc00 && unit <= 0xdfff) {
          _escape(unit, out); // lone trail surrogate
        } else {
          out.writeCharCode(unit);
        }
    }
  }
  out.write('"');
}

void _escape(int unit, StringBuffer out) {
  out.write(r'\u');
  out.write(unit.toRadixString(16).padLeft(4, '0'));
}
