| # | Ipsum | Dolor | Sit |
|---|---|---|---|
| 1 | `lorem.ipsum` absent | Amet built without a sit (`consectetur:339` guards for this too) | Adipiscing |
| 2a | `elit.value` undefined — **early return** | `useAdipiscing.ts:49` skips `getSit` for dolor-sit amet | **Deterministic**, but currently masked by `elitwithSit` |
| 2b | `getSit` rejected | Not silent — breaks init loudly (no try/catch at :82) | Consectetur |
| 2c | Startup race | Narrow: :82 is awaited before init resolves | Adipiscing |
| 3 | Selected sit filtered out | `loremFilter` restricts to `rootStore.validSit` | Adipiscing |
| 4 | `useEloit()` throws | Module not initialised — caught at :215, returns null | Consectetur |
| 5 | `ipsum` null / missing / lacks the code | The unverified backend risk | **Unknown — blocks Step 1** |
| 6 | Sit not from the sit | User typed the code manually, or it carried over from an earlier sit/upgrade | Adipiscing |
