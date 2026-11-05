# Voting Rules and Legal Configuration Points

> **Important.** This system makes governance rules configurable and auditable. It does **not** determine what the law requires. The Companies Act 1994, BSEC rules and guidelines for listed companies (including those on digital and hybrid general meetings), each company's articles of association, and any court or regulator directions must be reviewed by the company's legal adviser. That review must happen for every meeting configuration before production use. Defaults below are conservative engineering defaults, not legal advice.

## 1. Engine guarantees (not configurable)

1. **Eligibility comes only from record-date entitlements.** Live register changes after the snapshot do not affect a meeting.
2. **One effective ballot per entitlement per voting session.** A partial unique index on `ballots (voting_session_id, entitlement_id) WHERE superseded_at IS NULL` enforces it.
3. **Idempotent submission.** Each ballot request carries an `Idempotency-Key`. A replay returns the original result and never creates a second ballot.
4. **Transactional casting.** In one transaction the engine locks the entitlement row (`SELECT ... FOR UPDATE`), checks the session is open (`now() < closes_at AND closed_at IS NULL`), inserts the ballot, and appends a hash-chained vote audit event.
5. **No silent edits.** Ballots have no UPDATE path except setting `superseded_at` during a voter-initiated change, when that is allowed. Database triggers block other updates and all deletes.
6. **Weights are snapshotted** onto the ballot at cast time from the entitlement.
7. **Secrecy.** Staff roles see aggregates only, and only after release where configured. `ballot.individual.read` comes only from a time-boxed, audited privileged grant.
8. **Closing is final.** A closed session cannot be reopened. A new session needs an explicit, audited admin action with a reason.

## 2. Configuration points

Stored per meeting in the `meetings.rules` JSONB. Agenda items may override some values. Rules are validated against a versioned Zod schema, and changes after Scheduled are audited with before and after values. They lock when the meeting goes Live.

| Key | Options | Default | Notes for legal review |
|---|---|---|---|
| `votingMethod` | `SHARE_WEIGHTED`, `ONE_MEMBER_ONE_VOTE` | `SHARE_WEIGHTED` | Show of hands compared with a poll. Confirm per articles and applicable rules. |
| `votesPerShare` | taken from share class | 1 | Non-voting classes are excluded. |
| `choices` | subset of `FOR`, `AGAINST`, `ABSTAIN` | all three | Whether abstentions count toward the base. |
| `abstainCountsInBase` | boolean | false | Affects majority calculation. |
| `allowVoteChange` | boolean | **false** | Never assumed. If true, only the voter can supersede their ballot, and only before closure. |
| `ordinaryMajority` | fraction | > 1/2 of votes cast | |
| `specialMajority` | fraction | ≥ 3/4 of votes cast | Confirm the base: votes cast, or present and voting. |
| `quorum` | `{ members: n }` and/or `{ holdingPct: x }` | none (reported only) | The system reports quorum status. The chair decides. |
| `pollDemand.enabled` | boolean | false | |
| `pollDemand.threshold` | `ANY_MEMBER`, `{ members: n }`, `{ votingRightsPct: x }`, `{ paidUpPct: x }` | none | Reported as met or not met. Never auto-acts. |
| `proposal.mode` | `FIRST_ACCEPTED`, `COLLECT_ALL` | `FIRST_ACCEPTED` | |
| `proposal.minHolding` | shares | 0 | |
| `seconding.excludeProposer` | boolean | true | |
| `proxy.allowed` | boolean | true | |
| `proxy.lodgementDeadlineHours` | hours before meeting | 72 | Commonly specified in articles. Confirm per company. |
| `proxy.maxPerProxy` | number or none | none | |
| `proxy.canVoteOnPoll` / `canSpeak` | boolean | true / false | |
| `corporateRep.requireBoardResolution` | boolean | true | |
| `votingWindow` | `DURING_MEETING`, `{ opensBefore: hours }` | `DURING_MEETING` | For any remote e-voting before the meeting. |
| `results.visibility` | `STAFF_AFTER_CLOSE`, `ALL_AFTER_RELEASE` | `ALL_AFTER_RELEASE` | |
| `results.showWeights` | boolean | true | |
| `audio.maxSeconds` | 120 to 180 | 150 | |

## 3. Tally

At session close the engine sums `weight` by choice over effective ballots. It applies `abstainCountsInBase` and compares the result with the resolution's required majority. It stores `voting_results` with the input hash: the hash of the ordered ballot ids plus the last audit hash. The result is sealed until release. Tally re-computation is deterministic and is part of the audit report.

## 4. Proxy and corporate rules

- A proxy entitlement is created only from an **approved, unexpired, unrevoked** proxy authorization for **this meeting**.
- If the grantor shareholder also attends, the configured precedence applies. The default is "shareholder present revokes proxy for the session", and it is audited.
- A corporate representative exercises every identity listed on their authorization. Each identity is a separate entitlement and ballot, so split voting across accounts is possible when the rules allow it.

## 5. Required tests (Phase E acceptance)

Duplicate submission, concurrent submission with 50 parallel requests on the same entitlement, idempotent replay, an unauthorized user, a non-entitled shareholder, a wrong-company entitlement, an expired or closed session, revoked and expired proxies, a proxy for a different meeting, weight correctness with mixed classes, a vote change when disallowed and when allowed, tally correctness, results hidden before release, and a direct database UPDATE blocked by the trigger.
