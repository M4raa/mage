# What's new in Mage

What changes from one version to the next, written for the people who use the app. The most recent version is at the top. Mage shows these same notes in its what's-new tab after an update, and in Settings › Release notes.

## 0.1.4 — 2026-11-07

### Added
- **Rewind, Retry and Branch.** From a message's bubble you can go back to that point in the conversation. With Claude you can also restore the files (checkbox off by default; it does not cover what was written with Bash). With Codex the conversation is rewound, not the files, and you can save a copy first. **Retry** repeats a turn and **Branch** opens a new conversation from that message ("Branch of …"). Whatever you had in the queue goes back to a draft.
- **Keep Claude's cache alive.** With a large conversation open (100,000 tokens or more, adjustable), Mage refreshes the cache before it expires with a minimal turn that does not stay in the conversation, so the next message does not pay for all of it again. It is configured in Settings, shows how many have been done and what they cost, and is off by default on API-key accounts.
- **The `mage` command in the terminal.** `mage chat` talks to your sessions from a terminal (it answers permissions and questions), `mage stop` closes a windowless Mage and `mage account add` registers an API-key account without the key going through the command line. On Windows, the installer adds it to your PATH (box checked); on Linux, the package leaves `/usr/bin/mage` if it is free. If no Mage is open, `mage` starts one without windows.
- **Terminal conversations show up in the window** as one more tab, with their account and model, and can be followed from both places.
- **Sessions that create sessions.** Mage offers itself as an MCP server to Claude and Codex (Settings › Mage MCP server): a conversation can hand work to another Claude or Codex one, ask its creator questions and return the result. Each delegate has its own tab with "Requested by …" and the maximum depth is adjustable (from 1 to 5).
- **The companion widget.** A pill that grows into a list of your sessions and their status (permission pending, error, working…), so you can answer a permission without going back to the window. It appears without taking your focus and respects "Do not disturb".
- **Capability library.** In Settings › Library: a curated catalog (with ECC) of skills, agents, MCP servers, hooks and plugins with their version, origin and license; a preview of what gets installed without running anything; install, enable, update and remove in your accounts without touching what isn't theirs. MCP servers that ask for a key store it in the vault.
- **Tasks.** A "Tasks" section in the sidebar to hand off general jobs (a document with sources, a summary, tidying up a folder) with their authorized folders and documents. The tab shows the plan, the progress and the deliverables, and Mage checks that the files exist and can be opened (it does not judge whether the work is good).
- **Built-in browser** in a panel, isolated from the rest of Mage, with a **pen** to draw on a capture and send it to the model.
- **New interface:** the sidebar gathers the conversations of all your accounts (Pinned, Projects, No project, Private) with filters and search (Ctrl/Cmd+K); redesigned tab, header and prompt box; `@` mentions of files, images and PDFs; a **pull requests** panel that tells apart PRs from different repositories with the same number; references to the chat's plan ("F0.4", "§3.4") become links; animated icons that respect "reduce motion".
- **The chat is much smoother** with long conversations: switching to a tab with thousands of messages goes from more than 1.6 s to about 130 ms.
- **Imported themes** with better contrast: Mage derives the borders, the selection and the focus when the theme does not tell them apart, and the text on the selection is readable (at least 4.5:1). An imported light theme now paints its colors.

### Changed
- The Windows installer is named `mage-<version>.exe` (it was `mage-setup-beta-…`).
- On Linux the package is called **`mage-desktop`**: Debian and Ubuntu already have another package named `mage`. If you had the 0.1.3 `.deb`, uninstall it first (`sudo apt remove mage`).
- Deleting a Codex conversation really deletes it on disk (before, it only disappeared from the list), along with its revisions.
- The Windows installer asks for the language and Mage uses it on its first launch.

### Fixed
- Conversations created from the terminal or by another session always use their own account and model; if Mage cannot tell which, the tab becomes read-only (it never charges another account).
- The error from an invalid API key is shown as an error, in the window and in `mage chat`, instead of an empty turn.
- `mage chat` no longer loses what you type before the session is ready.
- Escape on an open menu no longer interrupts the turn.
- An invisible bar no longer covers small tables in the chat.
- The AppImage in terminal mode works without a display.
- With a large zoom, all the chat notices are visible.
- `@` mentions also offer files in a folder that a parent repository ignores.
- `mage chat --account` accepts the name you gave in `mage account add --name`, and host errors come out in the terminal's language.
- Deleting a conversation also deletes what Mage kept of its rewinds.
- Migrating a new chat with no messages no longer makes the tab disappear.

### Security
- The built-in browser does not share cookies or session with yours, has no access to Mage and only opens `http(s)` and `localhost`.
- Mage's MCP server only serves Mage's own sessions (each with its own credential) and each one only sees the sessions it created.
- A terminal client checks that the host is Mage's before sending it anything.

### Known limitations
- The tools that let the agent drive the browser (navigate, click, type, capture) are not in this version: they will come in 0.1.5. The browser panel and the pen are.
- With Codex: files are not rewound; a task's extra folders are read-only; some of what is new (PDF mentions, a delegate's questions, the browser) could not be tested with a real Codex.
- With the virtualized chat, the browser's find (Ctrl+F) does not find messages that are not on screen.
- While a windowless Mage is running, the shortcut does not open the window: close it with `mage stop`.
- Linux: only tested on WSL without a desktop (Ubuntu 26.04, Debian 13, Arch). The rpm is generated untested.
- Installing and auto-updating from 0.1.3 on Windows has not been tested on a clean machine.

## 0.1.3 — 2026-11-02

### Fixed
- A Claude conversation that was rewound in the CLI no longer shows, when reopened, the part that was discarded: Mage reads only the branch that is still alive, with all its tools, including those launched in parallel.
- A rewound Codex conversation appears only once in the history, and when reopened or migrated to another account what was discarded no longer reappears.
- The cost notice when changing model or effort says which tab it is for, also in an untitled tab ("New chat").
- The "Bypass permissions" notice appears when you turn it on, not when you return to a chat that already had it or when you reopen Mage.
- Long chat notices (including paths without spaces) wrap and no longer overflow the panel.
- Settings › Release notes has "Check for updates", which checks right away and says whether it is checking, whether Mage is up to date, whether there is an error or whether a version is ready.
- A Claude account without a valid login, the main one included, offers "Sign in" from the sidebar without recreating it.
- Closing a tab activates the next one (or the previous one), not the first.
- Tabs are reordered by dragging them in their bar, and dropping one onto another panel's bar brings them together.
- The ⏎ in the prompt is a button that sends; if sending fails, the message goes back to the box.
- Activity says it is loading, or gives the reason for the error, when reopening a conversation instead of "No activity yet".
- MCP OAuth login avoids ports blocked by the browser and explains invalid fixed ports.
- Avatars take the initial of the account name. Each new account gets the least-used color and keeps it when others are added, so they do not repeat while free colors remain. The default color of existing accounts may change once with this version; hand-picked ones are kept.
- Registering your own provider and immediately opening a conversation with it no longer fails with "Provider not configured".
- Conversations show an indicator while they load and the reason if they cannot be read.
- With the window split, a question in the other panel no longer steals focus, and the chat keeps showing the end when a question appears. "Something else" is reachable with the arrow keys.
- Settings › Storage has "Allow Artifact (publishes to claude.ai)", off by default: with it, Claude Code sessions can use the Artifact tool (applied when the conversation is reopened).
- New chats start with worktree turned off; each tab's choice is kept across restarts.
- Bullets in the prompt remain bullets on the cursor's line.
- New drafts are saved outside the temp folder. If an old draft disappears, its folder is recreated and the lost files are reported.
- Trust recognizes equivalent paths, allows authorizing the parent folder and respects revocations. Mage's drafts are trusted by default.
- The handoff uses a fork without persistence and does not add its internal instruction to the original conversation.
- A missing executable no longer causes repeated start-up retries.
- Bringing in a worktree's base accepts Mage's local copies and still rejects uncommitted changes.
- The Context panel no longer counts a cache that expired after a pause as a compaction: only the CLI's real compactions.
- A Codex turn's token usage counts all the model calls in the turn, not just the last one.
- A Codex or agy conversation recovers its model and effort when reopened from the history.
- Codex and agy tabs no longer come back empty when Mage restarts: they reopen with their conversation. A tab saved by 0.1.2 whose conversation cannot be found says so ("Open it from the account's history") and its first message starts a new one.
- A Codex or agy conversation that keeps working in the background can no longer be opened in another window from the history, and deleting it, moving it or reopening it for its agent is refused before touching it.
- The history sorts and dates Codex conversations by their last message: Codex does not update its files' modification date and a long conversation was left with the time it started.
- During "Create PR", a forced push or skipping hooks is denied even if the conversation has "Always allow Bash", also with the tab closed.
- Checking Git status revalidates the account's permissions before returning cached data.
- The vault explicitly rejects insecure Linux backends, even if they advertise encryption as available.
- Refreshing a truncated transcript replaces the previous history and its errors.
- Incremental reads keep their indexes after blank lines and wait for a partial line to finish.
- The built-in runtime recovers its tools when switching to a model that supports them.
- An error while checking a permission keeps a valid history so the conversation can continue.
- Closing a session releases the MCP client even if it is still querying its tools.
- Auto allows wildcards on internal files even when there are other names with Unicode characters.
- When answering a permission, the card stays on "Sending…" with the buttons disabled and closes with the decision Mage accepts. If another window or client answered first, it closes with their decision without an error; if sending fails, the error is shown and the permission stays pending.
- Errors coming from the main process are shown without the technical prefix "Error invoking remote method…".
- On Linux without `which` (Arch), Mage finds the programs on the PATH: the agents' CLIs, `gh`, `git`, the editors and the shell no longer show up as not installed.
- On Windows, renewing a conversation's lock or saving a setting while another process reads that file no longer fails: it retries for a moment.
- A new Codex conversation shows that it starts read-only (it asks permission before writing), with "Allow writing" so it can write inside its folder.

### Added
- Mage speaks **English**. In Settings › Appearance › **Language** you choose **System**, **Español** or **English**, and the interface changes instantly, without restarting. Dates, numbers and plurals follow the chosen language; in Spanish decimals use a comma ("1,2 s", "12,50 $"). What you send to the model does not change with the interface language.
- **Send now or queue.** With a turn running, **Enter** puts the message in the queue, which goes out when the turn ends, and **Ctrl+Enter** (**Cmd+Enter** on macOS) sends it now, to correct the agent while it works. The send button splits into **Queue ▾ Send now**. If the agent is waiting for a permission, the direct message reaches it when you answer. A queued message is edited in its own row (Enter saves and Escape cancels) and can be removed.
- Mage provides a local host for other clients: a private socket that only opens for whoever has that run's token, with a versioned protocol. It sees the same event stream as the window, answers permissions and questions (they are answered only once, whoever wins) and can send messages. It can create sessions in a folder that is already trusted; it does not grant trust on its own.
- A conversation open in another Mage instance (the installed one, the development one or another profile) is shown read-only, with the notice "Open in another Mage instance (<profile>)". If that instance releases it or closes, this one becomes the owner without clicking anything (also when returning to the tab or the window) and says so with "You can continue here now"; if it crashes, "Take over" appears. A `claude` launched by hand in a terminal cannot be locked from Mage.
- On Linux without a desktop, Mage starts as a windowless host (with `--headless` or without `DISPLAY`). Asking that host for the graphical interface says it is not available and does not restart it or touch its sessions.

### Security
- The local host answers a challenge signed with the session token, so a client can check that it is talking to Mage before sending it the token. A program that takes the host's name before Mage cannot impersonate it: without the token it cannot sign the answer.
- Creating a session from the local host requires the folder to be trusted, the same as from the window.
- The interface runs in Chromium's sandbox in all three windows (main, widget and debug).
- Commands on a session (send, answer, stop, change model…) are validated before reaching the engine and are only accepted from the window that created it or the main one.
- On Linux, if Mage starts without Chromium's sandbox (the AppImage does so when the system does not allow user namespaces), it warns persistently with the reason and recommends the .deb package or enabling those namespaces.
- If the local host fails to start, the window warns persistently with the reason; the interface keeps working. A failed start does not leave the host's token or address on disk.
- On Linux, Mage checks the keyring at startup without activating services and in under 3 seconds. If it is not installed, running or unlocked, subscription accounts keep working, and creating or using an API account gives an error with the keyring's state, your distribution's commands and the link to the guide; that attempt no longer leaves the account's folder created. Without a desktop, Mage asks for the Secret Service so it can use the vault.
