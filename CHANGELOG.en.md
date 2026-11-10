# What's new in Mage

What changes from one version to the next, written for the people who use the app. The most recent version is at the top. Mage shows these same notes in its what's-new tab after an update, and in Settings › Release notes.

## 0.1.5 — 2026-11-10

### Added
- **Accounts and usage.** Clicking the usage summary in the status bar opens a screen with all your Claude, Codex and Gemini (agy) accounts: on the left, each account with its usage windows and cost; on the right, the selected one in detail with its equivalent cost at list prices, tokens, replies, conversations, the limits hit, a chart by day and a breakdown by model. If you enter what you pay for the plan, Mage works out how much of it you use and how much value you get. From there you can also sign in or refresh the session, rename, change the color, hide or remove an account.
- **Background tasks.** Whatever the agent leaves running (a background command, a monitor) shows up in its own dock above the input, with its elapsed time and a button to stop it, so the chat no longer looks stuck.
- **"Refresh session"** on an expired account, and on startup Mage renews the expired ones by itself.
- In Settings › Providers and models, each provider is a card with its logo, and Codex and agy have a default permission mode and effort.

### Changed
- **Mage's MCP server is off by default.** Once on, every new or reopened Claude or Codex conversation loads it, private ones included (those already open are not relaunched). When it is off, the model knows it has no Mage sessions or browser and tells you so instead of replacing them with something else.
- **MCP and connectors, redesigned:** Servers, Connectors and Extensions use the same row (status, name, tags and the main action), and Mage's MCP is at the top with its switch.
- **New prompt box:** "+" (with the actions and attach image), the text and send; underneath, the account, folder, branch, "Shared" and the context % on the left, and the model, effort and permission mode (now a selector) on the right.
- The status bar reads "provider · account" and shows usage as two small bars with their %.
- **Agent questions:** you can jump to any question through its steps, "Something else" is one more option, single choice (circle) and multiple choice (checkbox) look different, and "Submit" is always enabled: whatever you leave unanswered goes as skipped. Half-finished answers are kept when you switch chats.
- Scratch conversations do not belong to any project unless you move them yourself, and projects are shown 10 at a time ("Show N more…"), the most recently touched first.
- Scrolling up in the chat shows "Jump to the end", centered above the input.
- Delegated sessions notify their creator with the reply and the creator carries on by itself. Read-only tools of Mage's MCP do not ask for permission.

### Fixed
- **Lag while typing, switching tabs and streaming:** Mage was re-reading the conversation index on every query. It now reads it once.
- The chat has its spacing between messages back; the wheel, ↑, PgUp or Home leave the bottom right away, and the chat only sticks again when you reach the very end.
- Coming back to a chat no longer loses the message to "SDK host reconnected".
- The agent's browser tools work again, and the browser panel takes its full height (it used to show blank).
- `@` and `/` suggestions appear above their character, not at the start of the input.
- The all-accounts usage popover scrolls and you can move the mouse into it.
- The "API billed" tag has its color back.
- An account's alias no longer carries the provider prefix.
- A shared conversation with no recorded account no longer shows the active account.
- In the editor, the bullet has its own space and lists use a hanging indent.
- The new chat's recent folders list is shorter and scrolls.

## 0.1.4 — 2026-11-08

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
- **Four buttons on every permission prompt:** "Allow once", "Allow for this session", "Always allow" and "Deny" (keys 1–4). "Always allow" exists only in Claude: it saves the rule, per command, in that account's settings and warns first that it will apply to all its new conversations. Codex and your own providers have "once", "this session" and "deny". Gemini (agy) doesn't ask for permission: it applies its rules without asking. "This session" and "always" aren't offered for questions or for `git push`, `git commit` or `gh pr create`.
- **Attach images** with a button in the prompt bar or by dropping them on the chat (as well as pasting them).
- **Snapping when resizing** panes and tools: the divider snaps to 25, 33, 50, 67 and 75 % (hold Alt or Shift to turn it off).
- **Delegated sessions inherit** the permission mode, effort and model of the session that starts them, unless the request says otherwise ("with sonnet, high effort and plan mode"). They can never have more permissions than their creator.
- The **Files** panel is grouped into Created, Edited, Read and Mentioned, also for Codex and agy.
- Typing `/` in the middle of a sentence suggests skills and project or plugin commands.

### Changed
- The Windows installer is named `mage-<version>.exe` (it was `mage-setup-beta-…`).
- On Linux the package is called **`mage-desktop`**: Debian and Ubuntu already have another package named `mage`. If you had the 0.1.3 `.deb`, uninstall it first (`sudo apt remove mage`).
- Deleting a Codex conversation really deletes it on disk (before, it only disappeared from the list), along with its revisions.
- The Windows installer asks for the language and Mage uses it on its first launch.
- `/rename <name>` renames the tab instantly, even while a turn is running.
- Copying a message with images copies the text and the first image (the system clipboard holds only one). In the text, each `[Imagen N]` image you added with the button or by dragging it carries its path; pasted ones don't.
- The default permission keys are now 1/2/3/4 (Deny moves from 3 to 4). Shortcuts you changed are kept.

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
- Gemini (agy) no longer fails to start with "--model … conflicts with --effort": for models that already carry the effort in their name, the effort control is hidden.
- Switching account on a new tab also switches its provider and model (the message could previously go out on the old account).
- Continuing a chat on another account keeps it in the same place, with its title and your unsent text.
- Sending with Ctrl+Enter right as the turn ends no longer leaves the tab busy with a 0-token turn, nor loses the message: Mage no longer causes the CLI to drop it and, if it still isn't submitted, says so and puts it back in the prompt.
- **Costs for API-key accounts were over-counted** in every conversation longer than one turn (the CLI reports a cumulative cost and Mage added it up on every turn). They are counted correctly from this version on; see "Known limitations".
- In tabs created from the terminal or by another session, the reply no longer appears twice.
- The selected model in the pickers is readable without hovering.
- A list bullet in the prompt no longer disappears when the cursor is next to it.

### Security
- The built-in browser does not share cookies or session with yours, has no access to Mage and only opens `http(s)` and `localhost`.
- Mage's MCP server only serves Mage's own sessions (each with its own credential) and each one only sees the sessions it created.
- A terminal client checks that the host is Mage's before sending it anything.
- The terminal (`mage chat`) and any other process can no longer switch a session to "Bypass permissions": only the window can.
- The Mage window no longer loads outside pages (for example, when a link is dropped outside the chat).
- Mage no longer passes to agents the Microsoft Foundry variables, the Bedrock token, Anthropic custom headers, `OPENAI_BASE_URL` or `GOOGLE_GENAI_USE_VERTEXAI` from your environment (they could change who gets billed).
- The MCP library is updated to 1.32.2, which fixes forwarding headers when following a redirect to another server.

### Known limitations
- The tools that let the agent drive the browser (navigate, click, type, capture) are not in this version: they will come in 0.1.5. The browser panel and the pen are.
- With Codex: files are not rewound; a task's extra folders are read-only; some of what is new (PDF mentions, a delegate's questions, the browser) could not be tested with a real Codex.
- With the virtualized chat, the browser's find (Ctrl+F) does not find messages that are not on screen.
- While a windowless Mage is running, the shortcut does not open the window: close it with `mage stop`.
- Linux: only tested on WSL without a desktop (Ubuntu 26.04, Debian 13, Arch). The rpm is generated untested.
- Installing and auto-updating from 0.1.3 on Windows has not been tested on a clean machine.
- Usage totals for API-key accounts saved before this version are inflated and are not recalculated. They only go back to zero if you remove the account and add it again. A conversation that already existed adds its cumulative cost once, on its first turn after updating.
- The cost of "Keep Claude's cache warm" on API-key accounts is still over-counted: fixed in 0.1.5.
- All Claude accounts share the conversations, skills, plugins, commands and agents in `~/.claude`, and a new account inherits the main account's permission rules; this can't be separated per account yet.
- With Codex, a delegated session's translation of Claude's permission mode has only been tested with tests.
- Deleting an `[Imagen N]` token from the text doesn't remove the attached image; remove it from its thumbnail.

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
