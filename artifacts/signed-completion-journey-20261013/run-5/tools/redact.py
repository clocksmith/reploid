"""Copy stdin to stdout replacing the private room token, which is read from the room file (never from argv).
Usage: ... | python3 redact.py <private room json> > out"""
import json, sys
token = json.load(open(sys.argv[1]))['token']
sys.stdout.write(sys.stdin.read().replace(token, '[REDACTED]'))
