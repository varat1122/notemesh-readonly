/** Fixed synthetic bytes from the owner handoff; no caller-defined paths/content. */
export const BOOTSTRAP_ROOT="m4-bootstrap-20261025";
export const BOOTSTRAP_FIXTURES=[
  {
    "id": "m4-bootstrap-20261025-source-a",
    "path": "10_Knowledge/M4TEST - Synthetic Source A.md",
    "content": "---\ntype: research_note\nentity: M4TEST\nevent_key: M4TEST-SYNTH-A-20261025\nperiod: SYNTHETIC\nsource_type: user_supplied\nverification: unverified\nsynthetic: true\n---\n# Synthetic Source A\nOperational acceptance fixture only. M4TEST is not a real issuer. The fictional input says demand may rise; revenue conversion is unknown. No real investment claim or recommendation.\n"
  },
  {
    "id": "m4-bootstrap-20261025-source-b",
    "path": "10_Knowledge/M4TEST - Synthetic Source B.md",
    "content": "---\ntype: research_note\nentity: M4TEST\nevent_key: M4TEST-SYNTH-B-20261025\nperiod: SYNTHETIC\nsource_type: user_supplied\nverification: unverified\nsynthetic: true\n---\n# Synthetic Source B\nOperational acceptance fixture only. M4TEST is not a real issuer. The fictional input says delivery remains uncertain; recall the prior interpretation. No real investment claim or recommendation.\n"
  },
  {
    "id": "m4-bootstrap-20261025-hub",
    "path": "01_Companies/M4TEST.md",
    "content": "---\nentity: M4TEST\nsynthetic: true\n---\n# M4TEST\nFictional acceptance entity. Not a real company.\n"
  },
  {
    "id": "m4-bootstrap-20261025-timeline",
    "path": "08_Daily_Weekly/Research Indexes/Company Evolution - M4TEST.md",
    "content": "---\ncompany: M4TEST\nsynthetic: true\n---\n# Evolution\nSynthetic initial history. No investment facts.\n"
  }
] as const;
