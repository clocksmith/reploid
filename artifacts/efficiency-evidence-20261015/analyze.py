"""Recompute efficiency bounds from the retained compact numeric extract."""
import argparse
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent

def grouped(row):
    groups={k:0.0 for k in ['transfer_delivery','execution_boundary','authorization','serialization','other']}
    for k,v in row['decode_mean_segments_ms'].items():
        g=('transfer_delivery' if k.startswith('transfer.') else
           'execution_boundary' if k.endswith('.doppler') or k.startswith('mac.') else
           'authorization' if 'authorization' in k else
           'serialization' if k.startswith('serialization.') else 'other')
        groups[g]+=v
    assert abs(sum(groups.values())-row['decode_mean_ms'])<0.01,'Segments do not reconcile'
    return groups


def run(data):
    rows=[]
    for row in data['rows']:
        g=grouped(row); total=row['decode_mean_ms']
        rows.append({**row,'groups_ms':g,'transfer_fraction':g['transfer_delivery']/total,
                     'serialization_fraction':g['serialization']/total,
                     'ideal_no_transfer_speedup_ceiling':total/(total-g['transfer_delivery']),
                     'ideal_no_serialization_speedup_ceiling':total/(total-g['serialization'])})
    controls={Path(x['source']).stem:x for x in data['uninstrumented_and_instrumented_controls']}
    comparisons=[]
    for i in [1,2]:
        a=controls[f'turns-baseline-{i}'];b=controls[f'turns-instrumented-{i}']
        for x,y in zip(a['turns'],b['turns']):
            assert x['label']==y['label'] and x['tokens']==y['tokens']
            comparisons.append({'pair':i,'label':x['label'],'baseline_ms':x['answer_ms'],
                                'instrumented_ms':y['answer_ms'],'ratio':y['answer_ms']/x['answer_ms'],
                                'interpretation':'Sequential runs in uncontrolled conditions; not isolated instrumentation overhead'})
    local_s=8.21+100*0.2865
    # Equal acceptance rate on both providers makes acceptance probability cancel
    # in this energy-only necessary condition. It is not a quality-equivalence claim.
    alt_per_attempt=(56*0.17+100*0.25)/1e6
    return {'rows':rows,'baseline_comparisons':comparisons,
            'retained_installed_answer_s':147.8,'derived_local_amd_answer_s':local_s,
            'derived_time_ratio':147.8/local_s,
            'same_precision_kernel_decode_speedup':570.4/286.5,
            'same_precision_kernel_prefill_speedup':17.04/8.21,
            'conditional_power_limits_at_20c_kwh':{
                'alternative_raw_price_56_in_100_out_usd':alt_per_attempt,
                'route_watts_at_equal_acceptance_rates':alt_per_attempt*3.6e6/(0.20*147.8),
                'local_watts_at_equal_acceptance_rates':alt_per_attempt*3.6e6/(0.20*local_s),
                'scope':'Necessary energy-only limit, excluding idle and all other costs. Alternative quality/deadline equivalence is untested.'}}


def render(r):
    lines=['# Efficiency evidence calculations','',
           'Provisional breakdowns, not a new qualified runtime or controlled A/B benchmark. Percentages use means from matching steps, never sums of medians. Transfer includes delivery scheduling, not just network propagation.','',
           '| Probe / turn | Answer seconds | Mean decode ms | Transfer/delivery ms (%) | Execution boundary ms | Authorization ms | Serialization ms |',
           '|---|---:|---:|---:|---:|---:|---:|']
    for row in r['rows']:
        g=row['groups_ms'];label=Path(row['source']).stem+' / '+row['label']
        lines.append(f'| {label} | {row["answer_ms"]/1000:.1f} | {row["decode_mean_ms"]:.1f} | {g["transfer_delivery"]:.1f} ({100*row["transfer_fraction"]:.1f}%) | {g["execution_boundary"]:.1f} | {g["authorization"]:.1f} | {g["serialization"]:.1f} |')
    lines+=['','Probe 2 first-answer has one step error and no prompt breakdown. Its decode observations remain diagnostic; no complete prompt attribution is claimed. Native host subtimings can contain small negative residuals; do not interpret every fine-grained category as independently measured.','',
            '| Sequential control pair / turn | Baseline seconds | Instrumented seconds | Ratio |','|---|---:|---:|---:|']
    for x in r['baseline_comparisons']:
        lines.append(f'| {x["pair"]} / {x["label"]} | {x["baseline_ms"]/1000:.1f} | {x["instrumented_ms"]/1000:.1f} | {x["ratio"]:.2f} |')
    lines+=['','These differences prevent claiming an isolated tracing overhead or a performance improvement from this sequence. Stabilize workload/network conditions and use repeated controls.','',
            f'Whole AMD paired-model arithmetic: 8.21 + 100 x 0.2865 = **{r["derived_local_amd_answer_s"]:.2f} s**. Installed placement C: 147.8 s. The ratio **{r["derived_time_ratio"]:.2f}x** is a cross-path opportunity estimate, not an installed improvement.',
            '',f'Retained paired kernel controls show **{r["same_precision_kernel_decode_speedup"]:.2f}x decode** and **{r["same_precision_kernel_prefill_speedup"]:.2f}x 56-token prefill** improvement with the unchanged correctness gate.', '',
            '## Conditional competitive power budget', '',
            'At the retained Together Qwen3.5 9B raw price, 56 input/100 output tokens cost $0.00003452. Only if task quality and deadlines are equivalent, and both paths have equal acceptance rates:', '',
            f'- At 147.8 seconds/attempt, route active power must be below **{r["conditional_power_limits_at_20c_kwh"]["route_watts_at_equal_acceptance_rates"]:.2f} W** at $0.20/kWh to beat that bill on electricity alone.',
            f'- At the derived 36.86-second local time, the limit is **{r["conditional_power_limits_at_20c_kwh"]["local_watts_at_equal_acceptance_rates"]:.2f} W**.',
            '- Preparation, idle, verification, operations and failures can only tighten this energy-only bound. No hosted energy claim follows from its price.',
            '- This is not a deployment target or a proven equivalent-model comparison. It makes clear why the illustrative $10/M benchmark is insufficient.', '']
    return '\n'.join(lines)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
    r=run(json.loads((HERE/'trace-extract.json').read_text()))
    outputs={'analysis.json':json.dumps(r,indent=2,allow_nan=False)+'\n','ANALYSIS.md':render(r)}
    for name,text in outputs.items():
        p=HERE/name
        if args.check:assert p.read_text()==text,name+' is stale'
        else:p.write_text(text)
    print('Analysis verified.' if args.check else 'Wrote efficiency calculations.')
