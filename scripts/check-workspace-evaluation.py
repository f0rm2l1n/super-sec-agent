#!/usr/bin/env python3
"""Check optional evaluation inputs; this does not evaluate the security expert."""

import argparse
import json
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', required=True, type=Path)
    root = parser.parse_args().workspace.resolve()
    lock = json.loads((root / 'sources.lock.json').read_text())
    sources = {source['id']: source for source in lock['sources']}
    checks = json.loads((root / 'evaluation/checks.json').read_text())

    def git(source_id, *args):
        path = (root / sources[source_id]['path']).resolve()
        if not path.is_relative_to(root / 'sources'):
            raise RuntimeError('Source path escapes workspace')
        return subprocess.check_output(['git', '-C', str(path), *args], text=True).strip()

    for source in sources.values():
        if git(source['id'], 'rev-parse', 'HEAD') != source['revision']:
            raise RuntimeError(f"Baseline drift: {source['id']}")
    for anchor in checks.get('anchors', []):
        content = git(anchor['source'], 'show',
                      f"{sources[anchor['source']]['revision']}:{anchor['file']}")
        if anchor['contains'] not in content:
            raise RuntimeError(f'Missing entry anchor: {anchor}')
    manifest = checks.get('manifest')
    if manifest:
        content = git(manifest['source'], 'show',
                      f"{sources[manifest['source']]['revision']}:{manifest['file']}")
        projects = {e.attrib['name']: e.attrib for e in ET.fromstring(content).iter('project')}
        for expected in manifest['projects']:
            actual = projects[expected['name']]
            if any(actual[key] != expected[key] for key in ('path', 'revision')):
                raise RuntimeError(f'Manifest mismatch: {expected}')
    for change in checks.get('changes', []):
        for revision in (change['from'], change['to']):
            git(change['source'], 'cat-file', '-e', f'{revision}^{{commit}}')
        if not git(change['source'], 'diff', '--name-only', change['from'], change['to']):
            raise RuntimeError(f'Empty change case: {change}')
    print(f"Evaluation inputs OK: {len(checks.get('anchors', []))} source anchors, "
          f"{len(checks.get('changes', []))} real change cases. No model run or score.")


if __name__ == '__main__':
    main()
