<div align="center">

# Claude Code Mods

**Small mods for the Claude desktop app.**

![TypeScript](https://img.shields.io/badge/TypeScript-TSX-3178C6?logo=typescript&logoColor=white)

</div>

## vscode-timeline

I like how the Claude extension for VS Code shows its work: every step is a row on a dotted line, and commands get a small box with what went in and what came out. The desktop app looks different, so I made this mod to give it the same look.

What it changes:

- Every step gets a colored dot: green when it worked, red when it failed, orange while it runs.
- Commands like Bash or PowerShell get a small box with the input and the first lines of output. You can open the box to see everything.
- Short steps like reading a file stay one simple line.
- The app's own widgets, like the task list or screenshots, stay the way they are.

## Install

Add this folder as a plugin marketplace in Claude Code and install vscode-timeline from it.

## License

MIT, see [LICENSE](LICENSE).
