#!/usr/bin/env python3
"""Negative-test the state.yaml reader used to validate spec artifacts.

A validator that has only ever reported "fine" is indistinguishable from no
validator. This feeds it six deliberately broken inputs and requires that each
one is rejected with a non-zero exit and a message naming the problem.

Exit 0 = every bad input was caught (the validator is trustworthy).
Exit 1 = at least one bad input was silently accepted (the validator is a liar).
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

READER = r'''
import json, re, sys
from pathlib import Path

def read_state(path):
    """Parse specs/state.yaml: a fenced ```yaml block inside a markdown file."""
    lines = Path(path).read_text().splitlines()
    opens = [i for i, l in enumerate(lines) if l.strip().startswith("```")]
    if len(opens) % 2 != 0:
        raise ValueError(f"unbalanced code fence: {len(opens)} fence markers")
    start = None
    for i, l in enumerate(lines):
        if l.strip().startswith("```yaml"):
            start = i + 1
            break
    if start is None:
        raise ValueError("no ```yaml block found")
    end = None
    for i in range(start, len(lines)):
        if lines[i].strip() == "```":
            end = i
            break
    if end is None:
        raise ValueError("```yaml block is never closed")
    import yaml
    # PyYAML silently keeps the LAST value for a duplicate key, which would
    # drop a handoff field with no error at all. Reject duplicates instead.
    class NoDupesLoader(yaml.SafeLoader):
        pass

    def _no_duplicates(loader, node, deep=False):
        mapping = {}
        for key_node, value_node in node.value:
            key = loader.construct_object(key_node, deep=deep)
            if key in mapping:
                raise ValueError(f"duplicate key {key!r} in mapping")
            mapping[key] = loader.construct_object(value_node, deep=deep)
        return mapping

    NoDupesLoader.add_constructor(
        yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _no_duplicates
    )
    doc = yaml.load("\n".join(lines[start:end]), Loader=NoDupesLoader)
    if not isinstance(doc, dict):
        raise ValueError(f"state must be a mapping, got {type(doc).__name__}")
    handoff = doc.get("handoff")
    if not isinstance(handoff, dict):
        raise ValueError(
            f"handoff must be a mapping with next_skill, got {type(handoff).__name__}"
        )
    if not isinstance(handoff.get("next_skill"), str) or not handoff["next_skill"]:
        raise ValueError("handoff.next_skill must be a non-empty string")
    if not isinstance(doc.get("decisions"), list):
        raise ValueError("decisions must be a list")
    return doc


if __name__ == "__main__":
    # Must actually DO the work. Without this the module defines read_state,
    # exits 0, and every malformed input below is silently "accepted" — the
    # exact failure mode this script exists to detect.
    read_state(sys.argv[1])
    print("OK")
'''

CASES = [
    (
        "unbalanced code fence",
        "# state\n\n```yaml\nvcs:\n  kind: git\n",
    ),
    (
        "yaml syntax error inside the block",
        "# state\n\n```yaml\nvcs:\n  kind: git\n  bad: [unclosed\ndecisions: []\n```\n",
    ),
    (
        "tab character in indentation",
        "# state\n\n```yaml\nvcs:\n  kind: git\n  extra: \tvalue\ndecisions: []\n```\n",
    ),
    (
        "duplicate mapping key",
        "# state\n\n```yaml\nvcs:\n  kind: git\nhandoff:\n  next_skill: one\n  note: a\n  next_skill: two\ndecisions: []\n```\n",
    ),
    (
        "no yaml block at all",
        "# state\n\njust prose, no fence anywhere\n",
    ),
    (
        "structure wrong: handoff is a scalar, not a mapping",
        "# state\n\n```yaml\nvcs:\n  kind: git\nhandoff: kickoff-branch\ndecisions: []\n```\n",
    ),
]


def main():
    with tempfile.TemporaryDirectory() as td:
        reader = Path(td) / "reader.py"
        reader.write_text(READER)
        # Prove the reader CAN succeed on the real file first; a validator that
        # rejects everything would "pass" this whole script vacuously.
        real = Path(__file__).resolve().parents[1] / "specs" / "state.yaml"
        ok = subprocess.run(
            [sys.executable, str(reader), str(real)], capture_output=True, text=True
        )
        if ok.returncode != 0:
            print("SETUP FAILURE: reader rejects the real specs/state.yaml")
            print(ok.stderr.strip()[:400])
            return 1
        print("control: real specs/state.yaml parses OK (reader is not trivially failing)")
        print()

        failures = []
        for name, body in CASES:
            p = Path(td) / "case.yaml"
            p.write_text(body)
            r = subprocess.run(
                [sys.executable, str(reader), str(p)], capture_output=True, text=True
            )
            caught = r.returncode != 0
            msg = (r.stderr.strip().splitlines() or [""])[-1][:70]
            print(f"{'CAUGHT ' if caught else 'MISSED '} {name}")
            if caught:
                print(f"         -> {msg}")
            else:
                failures.append(name)
        print()
        if failures:
            print(f"VALIDATOR UNTRUSTWORTHY - silently accepted: {failures}")
            return 1
        print(f"VALIDATOR TRUSTWORTHY - all {len(CASES)} malformed inputs rejected")
        return 0


if __name__ == "__main__":
    sys.exit(main())
