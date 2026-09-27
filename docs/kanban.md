# Workspace Kanban

Open **Kanban** from the desktop sidebar, command menu, or phone header. Conversations using the same workspace share a board.

- Four columns: Backlog, In progress, Review and Done.
- Cards have a title, details, Low/Normal/High priority, an optional due date, and up to 20 prerequisites.
- Drag a card onto a column to append it, or onto a card to place it before that card. Status menus and Move up buttons provide touch and keyboard alternatives.
- Search matches titles and details. Reordering is disabled while filtering.
- Click a title to edit or delete a card. Unsaved edits require explicit discard.
- **Work on this** prepares a draft. Desktop opens a new conversation with the current provider/model and the board's workspace. Phone appends to the current conversation's draft. Neither automatically sends a message or changes card status.

## Persistence and phone access

Boards live under the app configuration directory in `boards`, keyed by canonical workspace path. Writes are atomic and synchronous within an off-thread request. The UI loads boards on demand. The scheduler reconciles boards with assigned jobs once at startup and checks the current task during execution. Refresh to see changes from another screen.

Each mutation includes a revision. If another screen has saved newer data, Velum rejects the stale write and retains the open editor. Refresh, review your edits, and save again. Boards are limited to 300 cards, titles to 160 characters, details to 8,000 characters, and encoded storage to 4 MB. A failed save leaves the previous file intact.

The Android companion and browser use the desktop's board through the paired Tailscale or USB connection. The desktop must be running. View-only devices cannot mutate a board or prepare an agent task. The server derives the workspace from the selected desktop session; the phone cannot supply an arbitrary filesystem path.

## Plan work in order

Select **Prerequisites** in the card editor. Assigned work waits until every prerequisite is **Done**; Review still needs a decision. Cycles and self-dependencies are rejected. Both scheduled starts and **Run now** enforce this, and **Work on this** is disabled while blocked. Reopening or deleting a prerequisite blocks dependent work again. A running dependent task stops on the next scheduler check if its prerequisites become incomplete. Human status changes remain available; bot updates cannot progress blocked cards.

A due date is a calendar-day target, not a reminder time or a different cron schedule. Unfinished cards become overdue after that date in your local timezone. Among automatic jobs whose scheduled time has arrived, earlier due dates run first, then higher priority, then earlier scheduled time. Jobs without a due date follow dated jobs. Existing pause settings and run limits still apply.

**Needs attention** gathers overdue cards, blocked cards, and cards in Review. Completed cards stay out of this view. Use **Mark done** after reviewing results, or open a card to resolve its prerequisites.

## Recover deleted tasks

Deleting a card moves it to **Trash** and removes its scheduled job. Trash holds the 50 most recent deleted cards for up to 30 days; older entries expire when the board is next loaded and are removed from its file on the next save. **Restore task** keeps its status, details, owner, due date, prerequisites, and last summary, but switches automatic work off and clears the previous run link. Re-enable automatic work explicitly if needed. A removed bot must be replaced before its task can run.

Deleting a prerequisite does not silently remove the dependency. Restore it from Trash or uncheck the missing prerequisite in the dependent card. Permanent deletion requires a second confirmation and cannot be undone. View-only phones can inspect Trash but cannot restore or delete anything.

Boards remain local; they do not sync through GitHub. Assigning a bot creates a persistent schedule, and bot chats receive a bounded board snapshot when they run. See [bots and scheduled work](bots.md) for permissions, handoffs, context limits, and review behavior. Opening or organizing a board makes no AI requests.
