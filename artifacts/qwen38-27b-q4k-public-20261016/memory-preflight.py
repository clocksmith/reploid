from pathlib import Path
available=int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:')))*1024
assert available > 48*1024**3, 'Q4K preparation requires 48 GiB available host memory'
cards=list(Path('/sys/class/drm').glob('card*/device/mem_info_gtt_total'))
assert len(cards)==1, 'Expected one AMD GPU'
headroom=int(cards[0].read_text())-int(cards[0].with_name('mem_info_gtt_used').read_text())
assert headroom > 26*1024**3, 'Q4K requires its 24 GiB buffer budget plus 2 GiB GTT reserve'
print('Q4K memory preflight passed', flush=True)
