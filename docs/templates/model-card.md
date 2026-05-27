# Model Card

Owner: **AI Engineer** (and **LLM Architect** for LLM features). Required for anything model-driven that reaches production. The next engineer inherits your assumptions whether you write them down or not.

```markdown
# Model Card: [Feature / Model Name]
**Owner**: [agent]  **Date**: [date]  **Version**: [model + prompt/config version]

## Intent
What decision or output does this model produce, for whom, at what stakes?

## Approach & Research
Model class chosen (heuristic / classical ML / hosted / fine-tune / custom) and why,
per the Mandatory Research Standard (.claude/rules/lifecycle.md). Options compared:
accuracy, latency, cost-per-inference, operational burden, lock-in.

## Data
Training/eval data source, size, labeling rules, consent/privacy constraints,
known distribution gaps vs. production.

## Evaluation
Held-out eval set that mirrors production. Metrics overall AND per slice
(including the hard/sensitive slices). Latency P50/P95. Cost-per-inference.

## Bias & Fairness
Sensitive slices measured; any gap explained, mitigated, or explicitly blocked.

## Limitations & Failure Modes
Where it fails. Low-confidence behavior, timeout behavior, error behavior —
what the user sees instead of a wrong/confident answer.

## Commercial
Cost-per-inference × expected volume = COGS line. Is the feature profitable at scale?

## Monitoring & Retrain Trigger
Drift/quality signals watched in production. The signal that forces a retrain / re-prompt / re-tier.

## Reproducibility
Data version + code version + config + seed recorded (with MLOps).
```
