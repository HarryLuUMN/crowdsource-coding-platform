"""Run existing property rules on raw events and map proposals to semantic steps."""

import argparse
import copy
import json
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from property_rule_detector import detect_properties


def apply_detections(dataset, report):
    """Preserve manual labels; apply supported findings and queue candidates."""
    updated = copy.deepcopy(dataset)
    allowed = set()
    for group in dataset['codebook']:
        for code in group['codes']:
            allowed.add(code['id'])
    mapped = []
    skipped = []
    for detection in report['detections']:
        code = detection['property']
        if code not in allowed:
            skipped.append(detection)
            continue
        raw_indices = detection['steps']
        # Reading labels cover the opening series; other labels use an endpoint.
        targets = []
        if code == 'DOC_FIRST':
            evidence_indices = raw_indices
        else:
            evidence_indices = [max(raw_indices)]
        for step in dataset['steps']:
            if set(evidence_indices).intersection(step['rawStepIndices']):
                targets.append(step['index'])
        if not targets:
            skipped.append(detection)
            continue
        if code == 'PASTE_FIRST':
            targets = [min(targets)]
        elif code != 'DOC_FIRST':
            targets = [max(targets)]
        for index in targets:
            rule_id = str(index) + ':' + code
            status = 'candidate'
            if detection['status'] == 'supported':
                status = 'auto'
            event_numbers = []
            for raw_index in raw_indices:
                event_numbers.append(dataset['rawSteps'][raw_index]['sourceSteps'][0])
            mapped.append({
                'id': rule_id, 'step': index, 'code': code, 'status': status,
                'ruleVersion': report['rule_version'], 'reason': detection['reason'],
                'evidence': {
                    'rawStepIndices': raw_indices,
                    'events': event_numbers,
                    'detectorStatus': detection['status'],
                },
            })
            decision = dataset.get('ruleDecisions', {}).get(rule_id)
            if detection['status'] != 'supported' or decision in ['rejected', 'uncertain']:
                continue
            labels = updated['annotations'].setdefault(str(index), [])
            if code not in labels:
                labels.append(code)
    # Reuse existing IDs without duplicating suggestions on repeated runs.
    existing = {}
    for rule in updated.get('rules', {}).get('detections', []):
        existing[rule['id']] = rule
    for rule in mapped:
        existing[rule['id']] = rule
    updated['rules'] = {'version': report['rule_version'], 'detections': list(existing.values())}
    updated['automaticLabeling'] = {
        'ruleVersion': report['rule_version'], 'input': 'rawSteps',
        'coverage': report['coverage'], 'proposals': report['detections'],
        'unmapped': skipped,
        'limitation': 'Existing rules use KnitScript-oriented local units. Missing detailed errors and result events limit Vega-Lite coverage. Candidates are not confirmed labels.',
    }
    updated['trace']['dataNote'] = updated['trace']['dataNote'].replace(
        'No property annotations applied.',
        'First-pass automatic property labels applied; candidate findings require review. Error and local-edit coverage is incomplete.')
    if 'processing' in updated:
        updated['processing']['limitations'] = updated['processing']['limitations'].replace(
            'No automatic property annotations were applied.',
            'Automatic property labels come from a separate first-pass detector report; coverage is incomplete.')
    return updated


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--report-directory', type=Path)
    args = parser.parse_args()
    for key in ['5e219', '5f67b']:
        target = ROOT / 'annotation_data' / (key + '-units.json')
        dataset = json.loads(target.read_text())
        raw_input = dict(dataset)
        raw_input['steps'] = dataset['rawSteps']
        if args.report_directory:
            report_path = args.report_directory / (key + '-properties.json')
            report = json.loads(report_path.read_text())
        else:
            report = detect_properties(raw_input, trace_complete=True)
        updated = apply_detections(dataset, report)
        if args.apply:
            backup_dir = target.parent / '.backups'
            backup_dir.mkdir(exist_ok=True)
            backup = backup_dir / (key + '-before-detector-' + uuid.uuid4().hex + '.json')
            backup.write_bytes(target.read_bytes())
            target.write_text(json.dumps(updated, separators=(',', ':')) + '\n')
        print(json.dumps({'trace': key, 'applied': args.apply, 'findings': len(report['detections']),
                          'labeledSteps': len(updated['annotations']), 'coverage': report['coverage']}))


if __name__ == '__main__':
    main()
