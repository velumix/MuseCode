# A focused place to create

Start with an idea in the composer. **Build something**, **Improve what's here**, and **Understand a project** prepare an editable request. They preserve an existing draft and wait for you to send it.

![Focused conversation with expandable activity](images/focused-conversation.png)

## Keep attention on the work

- **Assistant settings** shows the provider, model, and reasoning level. Open it to change those choices or pick a bot.
- **Project folder** beneath the composer opens the folder picker and path editor. Applying a different project starts a fresh conversation; the explanation appears before applying it.
- Answers have a clear reading surface. Consecutive tool actions appear in one expandable activity group, with blocked or failed actions called out even while closed.
- Open the task summary to inspect the checklist. The composer and existing queue remain available while the agent works.

Under **Settings > Preferences > Conversation preferences**, turn off **Compact assistant controls** or **Group agent activity** if you prefer the full controls and individual tool cards. Themes, glass, typography, and layout preferences still apply. On a phone, assistant settings open from a disclosure above the conversation.

## Help the next attempt

Choose **Correct response** below a completed answer. Describe what should change, then send the correction. Velum includes a short excerpt of that answer so the agent can identify it. Your separate composer draft stays intact. If another response is active, the correction enters the same message queue.

To keep a durable lesson, select **Remember a lesson for this project**, review **Lesson for next time**, and choose **Send & save lesson**. Write a short, specific rule, such as “Preserve existing public APIs unless a breaking change is requested.” The checkbox starts off; typing a correction alone saves no lesson.

Reviewed lessons become active, pinned project notes in [Memory](memory.md). They are eligible for future context with Muse, Codex, and Antigravity, within the project's memory budget. A bot saves the lesson in its own memory. Memory disabled for that project remains disabled, and the confirmation explains this. Matching notes are reused rather than duplicated.

If sending fails, the correction stays editable and no lesson is saved. If the correction sends but saving fails, **Retry saving lesson** retries only the save. You can edit or archive lessons in Memory. Keeping lessons concise leaves more room for other useful context.

## Review suggestions

The agent may propose facts or lessons from user-confirmed corrections after a successful turn. An error by itself is insufficient evidence for a lesson. With the default memory setting, suggestions wait for your review; a count on **Memory** opens directly to **Review**.

Learning here means supplying reviewed local reference notes to future requests. It does not train the provider's model or guarantee the provider will follow every note. The existing memory reuse and context limits still apply.

Phone corrections follow the same flow. A paired device needs control permission to send or save, and losing access disables those actions.
