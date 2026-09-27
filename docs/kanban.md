# Workspace Kanban

Open **Kanban** from the desktop sidebar, command menu, or phone header. Conversations using the same workspace share a board.

- Four columns: Backlog, In progress, Review and Done.
- Cards have a title, details and Low, Normal or High priority.
- Drag a card onto a column to append it, or onto a card to place it before that card. Status menus and Move up buttons provide touch and keyboard alternatives.
- Search matches titles and details. Reordering is disabled while filtering.
- Click a title to edit or delete a card. Unsaved edits require explicit discard.
- **Work on this** prepares a draft. Desktop opens a new conversation with the current provider/model and the board's workspace. Phone appends to the current conversation's draft. Neither automatically sends a message or changes card status.

## Persistence and phone access

Boards live under the app configuration directory in `boards`, keyed by canonical workspace path. Writes are atomic and synchronous within an off-thread request. The board is read only when opened, refreshed or edited, with no startup scan or background polling. Refresh to see changes from another screen.

Each mutation includes a revision. If another screen has saved newer data, Velum rejects the stale write and retains the open editor. Refresh, review your edits, and save again. Boards are limited to 300 cards, titles to 160 characters, details to 8,000 characters, and encoded storage to 4 MB. A failed save leaves the previous file intact.

The Android companion and browser use the desktop's board through the paired Tailscale or USB connection. The desktop must be running. View-only devices cannot mutate a board or prepare an agent task. The server derives the workspace from the selected desktop session; the phone cannot supply an arbitrary filesystem path.

Boards are local planning data. They do not automatically track agent completion, sync through GitHub, schedule background jobs, or create token-consuming context. Task text enters a model request only when you send the prepared draft.
