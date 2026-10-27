# Persian Terminal

**English · [فارسی](README.fa.md)**

<a id="english"></a>

**Your commands. Persian you can read.**

Run programs, answer prompts and read Persian naturally inside VS Code. Persian Terminal brings connected Persian letters, right-to-left text and English commands together in a focused panel built for text output.

![Persian Terminal with display controls](media/screenshots/display-settings.png)

## Features

- **Readable Persian:** connected letters, adjustable alignment and the bundled Vazirmatn font, available offline.
- **Run files from the editor:** launch Python, Go, JavaScript, PHP, Ruby and Java files with a dedicated command.
- **One tab per file:** keep each file’s output separate. Running the same file again reuses its tab.
- **Restart without extra steps:** rerunning closes the previous session and starts fresh, even while the program is waiting for input.
- **Keep output for comparison:** turn on **Preserve previous output** in **Display** to retain earlier runs in the same tab.
- **Interactive input:** answer prompts from the panel and review submitted answers with compact input labels.
- **Independent shell sessions:** manual commands run in a general tab, where the working directory and environment persist between commands.
- **Search, copy and save:** find text in the current tab, copy a run’s output or export it to a file.
- **A display that fits your workflow:** adjust text size, compact or regular spacing, and Persian alignment.
- **Access to the native terminal:** switch to the underlying terminal when a program needs a full-screen interface or special keyboard input.

## Get started

1. Install **Persian Terminal** in VS Code. For a downloaded VSIX, use **Extensions: Install from VSIX**, then **Developer: Reload Window**.
2. Open the Command Palette and run **Persian Terminal: Open**.
3. Select an installed shell with Shell Integration enabled.
4. Run a supported file from the editor, or enter a command in the panel.

Try a simple command:

```sh
python -c "print('Hello from Persian Terminal!')"
```

Use `python3` if that is the Python command on your system. Language runtimes and compilers must be installed separately.

## Run files from the editor

### Python

Open a Python file and choose **Run Python File in Persian Terminal** from the editor’s run menu or context menu.

![Run Python File in Persian Terminal](media/screenshots/run-python.png)

The extension uses `persianTerminal.pythonPath` when configured; otherwise it checks the Python extension’s selected interpreter, then the project’s `.venv` or system Python where applicable. Python files run from the workspace folder, or their own folder when no workspace is open.

### JavaScript, Go and other languages

Choose **Run File in Persian Terminal** for Go, JavaScript, PHP, Ruby and Java files.

![Run JavaScript in Persian Terminal](media/screenshots/run-javascript.png)

![Run Go in Persian Terminal](media/screenshots/run-go.png)

| Language | Execution |
| --- | --- |
| Python | Selected Python interpreter with unbuffered output |
| JavaScript | `node file.js` |
| Go | `go run file.go` |
| PHP | `php file.php` |
| Ruby | `ruby file.rb` |
| Java | `java File.java` with a runtime that supports source-file execution |

These actions run the selected file. For a multi-file Go package, enter `go run .` in the appropriate folder; use `go test` for test files. Other build commands and languages can be run manually when their tools are installed. The panel is designed for text output.

## Tabs, reruns and output history

Each file gets a reusable tab named after it. Running another file keeps the previous file’s output in its own tab. Up to eight tabs can be open at once; close an unused tab to make room.

Rerunning a file starts a fresh session in the same tab. The old process is closed, and its environment changes are not carried over. Previous output is cleared by default.

To compare runs, open **Display** and enable **Preserve previous output**. This preference is saved and applies to subsequent runs. Switching it off does not immediately erase the current view. Output history is held in memory and has size limits; save important results to a file.

## Interactive input

![Answering a program prompt](media/screenshots/input.png)

While a program is running, the bottom field sends answers to that program. Enter your response and select **Send** or press **Enter**. To restart the file, use its editor run action again.

Submitted answers appear with a small input label. After execution ends, text following the last answer receives an output label. Labels follow the order of events; they do not interpret the meaning of the program’s text. Copy and export omit the display labels and separate input rows.

## Everyday controls

| Control | Action |
| --- | --- |
| Display | Text size, spacing, Persian alignment and output preservation |
| Folder | Change the working directory |
| Search | Find text in the current tab |
| Copy / Save beside a run | Copy or export that run’s output |
| Clear | Clear the view without closing the shell session |
| Stop | Send an interrupt to the running program |
| Native terminal | Open the underlying VS Code terminal |
| Double-click a tab name | Rename the tab |

**Keyboard shortcuts:** Enter runs a command or sends input; Shift+Enter adds a line; ↑/↓ browse history; Ctrl+F searches; Ctrl+L clears the view. Ctrl+C interrupts when no text is selected.

## Setup and troubleshooting

- Keep `terminal.integrated.shellIntegration.enabled` enabled. Use PowerShell 7 or Git Bash on Windows, or Bash, Zsh or PowerShell 7 on Linux/macOS.
- If the shell cannot connect, check the setup message in the native terminal. Windows PowerShell and PowerShell 7 are different shells.
- If a runtime is not found, install it and make it available to the shell. For Python, check **Python: Select Interpreter** or `persianTerminal.pythonPath`.
- Use the native terminal for full-screen tools, hidden password entry and arrow-key interfaces. Advanced cursor-based output may not render fully in the Persian panel.
- Some programs ignore Ctrl+C. Close their tab or rerun the file to replace the session.
- In native terminal mode, standard output and errors arrive as a combined stream.

## Development and feedback

```sh
npm ci
npm run package
```

Found an issue? [Open a report](https://github.com/A-F-Rashidi/persian-terminal/issues) with your operating system, shell and a short example that reproduces it.

Licensed under MIT.

