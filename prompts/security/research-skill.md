# Project security research

Research both how the project can be attacked and how it protects its assets.

## Understand a protection

Trace the protected asset and threat, implementation entry points, enabling configuration,
coverage and exceptions, deployment assumptions, failure boundaries, and evidence or tests.
Do not infer that a control protects every path, is enabled in production, or has been
validated merely because an implementation exists. Preserve unknown design intent.

## Investigate a risk

Identify the actor, controllable input, reachable path, relevant control and potential
impact. Search for counterevidence and compensating controls. A similar external CVE
is a lead; compare root cause, prerequisites and actual local implementation.
Prioritize severe impact and critical protections over low-impact code trivia.

## Record reusable understanding

Use the project workspace as a researcher's workbench. Keep project and external
documents in docs/, historical vulnerability and fix studies in vulnerabilities/,
and exploitation chains and prerequisites in exploits/. Relate cases by stable IDs
and source revisions; do not confuse a public analysis with a reproduced result.
Use research/ for ongoing investigations, knowledge/ for reusable understanding,
experiments/ for actual checks, and reports/ for reviewed results. Add directories
when useful rather than forcing all work into the initial categories.

For useful findings, retain the project and commit, question, claim or hypothesis,
code/history/document references, deployment conditions, supporting and opposing
evidence, unresolved questions and related knowledge affected by a correction.
Record actual paths and line locations where practical. Separate old-version facts
from conclusions checked at the current revision.

Knowledge files may support later work, but this initial integration does not enforce
a storage schema, update dependencies automatically, or ensure cross-ticket retrieval.
If no previous knowledge is accessible, state that and investigate from the available evidence.

## Understand how to run the target

When runtime conditions affect the research, investigate the real target's required
hardware, dependencies, matching component versions, build options, deployment,
identities and effective security settings. Retain environment/build/run instructions
in runtime/, with actual commands, artifacts, evidence and concrete blockers.
Separate documented procedures, a successful build, component startup and a real
use case traversing the target module. Check whether a container or emulator covers
the relevant kernel, device or multi-device behavior. Never invent successful execution.
Use existing validation capabilities for experiments and reproduction. Generated agent
configuration belongs in .agent/; it is independent of the target runtime/ materials.

## Work with people

Try to resolve code-answerable questions before asking an expert. Ask for concrete
business or deployment facts that the available evidence cannot establish.
Treat expert feedback as attributable, conditional evidence, reconcile contradictions,
and turn unresolved questions into specific next investigations.
