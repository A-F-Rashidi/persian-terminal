# Verification — Persian Terminal 0.2.1

Date: 2026-10-24. Environment: Linux, Node.js, mocked VS Code API and jsdom.

## Results

- TypeScript compilation: passed.
- `npm test`: **55 passed, 0 failed, 1 skipped** (56 tests total).
- The skipped test exercises persistent Windows PowerShell variables, table formatting, error status and recovery; it runs automatically on Windows.

## 0.2.1 regression checks

Concurrent and repeated probe requests launch one process; modifying the executable invalidates the cached result. Closing the last tab retains the verified shell rather than returning to a missing configured shell. Windows wall-clock speed has not been benchmarked. Cold shell startup remains.

## New evidence

- Real Bash/sh processes preserve variables, exported environment, functions and working directory across commands.
- Program stdin is separate from pending shell control syntax; a real child receives Persian input and a later command still runs.
- Independent sessions retain different values, execute concurrently and survive closing another tab.
- Clear removes transcript history without resetting the shell.
- Explicit exit/stop closes the relevant process; the next command starts a fresh session.
- Quoted executable arguments preserve spaces, Persian, apostrophes and shell metacharacters without unintended evaluation.
- Shell discovery rejects missing executables and probes real shell execution.
- Provider tests cover tab routing, output replay, configuration value validation, UTF-8 export and canceling the save dialog.
- DOM tests cover search across ANSI-colored segments, navigation between matches, copy/export without highlighted markup, independent input drafts and display preferences.
- Existing ANSI, bidi text preservation, output bounds, Python invocation, trust checks and CLIXML decoding regressions pass.

## Limits

No real Windows VS Code / Windows PowerShell 5.1 or Git Bash runtime was available. A PowerShell 7.4.6 Linux binary was downloaded for an extra smoke test, but its runtime could not initialize CoreCLR (`0x8007000E`); that attempt is not counted as a passing PowerShell test. Visual browser rendering was not verified in this environment. DOM checks do not establish font appearance or pixel layout.

This is a pipe-based persistent shell, not a PTY. Stop kills the session process tree, so variables and activation state do not survive Stop. Full-screen applications, job-control interfaces and reliable per-run attribution of background-job output remain out of scope. Shell profiles and session restoration after host reload are not implemented.

Before delivery, the ZIP and nested VSIX are CRC-tested and fully extracted. The installed package's session module and bundled runtime files are checked after extraction. See GUIDE-FA.md for a short Windows verification workflow.
