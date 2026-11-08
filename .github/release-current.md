Graphics preparation 0.11.1 adds an inspectable export quality report.

- Every AI pack writes quality-report.json.
- Includes the 20 worst and 20 best scored outputs.
- Includes every automatically detected failure and degraded fallback.
- Rows record hash/path, class, material, actual quality, backend, master scale, cache state and QA metrics.
- openrac-texture-pack.json points to the report via resilience.quality_report.
- Keeps the 0.11.0 selective 8×, multi-band reconstruction, material sidecars and guarded fallback stack.
