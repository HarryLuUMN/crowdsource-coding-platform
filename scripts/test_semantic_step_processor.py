"""Print a read-only processor pilot for one saved trace."""

import json
import sys
from collections import Counter
from hashlib import sha256
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from semantic_step_processor import SemanticStepProcessor


def main():
    path = Path(sys.argv[1] if len(sys.argv) > 1 else 'annotation_data/s4-units.json')
    files = list(Path('annotation_data').glob('*.json'))
    before = {str(file): sha256(file.read_bytes()).hexdigest() for file in files}
    dataset = json.loads(path.read_text())
    processor = SemanticStepProcessor()
    raw = dataset['rawSteps']
    grouped = processor.process_events(raw, raw[0].get('previousSource', ''))
    comparisons = []
    for step in dataset['steps']:
        if step['source'] == step['previousSource']:
            continue
        result = processor.compare(step['previousSource'], step['source'],
                                   evidence='snapshot_difference' if step['event'] == 'compiler.source_snapshot' else 'observed_edits')
        comparisons.append({'step': step['index'] + 1, 'kind': result['unitType'],
                            'rule': result['rule'], 'unit': result['unit'],
                            'beforeUnit': result.get('beforeUnit')})
    assert {i for step in grouped['steps'] for i in step['rawStepIndices']} == set(range(len(raw)))
    assert before == {str(file): sha256(file.read_bytes()).hexdigest() for file in files}
    print(json.dumps({
        'trace': dataset['trace']['label'], 'processor': processor.identity,
        'datasets_unchanged': True, 'raw_events': len(raw),
        'raw_output': dict(Counter(step['unitType'] for step in grouped['steps'])),
        'curated_comparisons': dict(Counter(item['kind'] for item in comparisons)),
        'comparisons': comparisons,
    }, indent=2))


if __name__ == '__main__':
    main()
