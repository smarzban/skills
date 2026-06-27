# Verification pass (re-review of prior findings)

You are **verifying**, not discovering. A prior round raised the findings listed at the **end of this
prompt**; the code has since been changed. Explore the checked-out branch and, for **each** prior
finding, decide whether it **still holds at the current HEAD**.

- Re-read the exact location and the code around it. A finding **still holds** when the problem it
  describes is still present in the code as it stands now.
- Report back **only the prior findings that still hold** — re-state each one as a finding object per
  the output contract below, keeping its original severity and location (adjust the line if code moved).
- **Do not** re-report a finding the change has resolved, and **do not** hunt for new, unrelated
  issues — this is a targeted re-check, not a fresh review.
- **One exception — direct regressions:** if a fix for a prior finding introduced a NEW problem at or
  next to that fix, report it the same way. Nothing else new.

Judge only what the code does now — verify against the actual source, not the prior finding's wording.
The findings to verify follow this prompt.
