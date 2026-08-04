# Automation Lifecycle

Every automation is listed in `catalogue.yaml` even when only proposed.

Progression:

```text
proposed -> documented -> dry_run -> supervised -> active
                                          |          |
                                          v          v
                                        paused --> retired
```

An automation may advance only when its inputs, system scope, approval boundary, duplicate protection, error handling, owner, and evidence are documented. `active` means unattended execution is explicitly approved; it must never be inferred from a successful manual test.
