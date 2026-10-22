## Tickets
- When the user starts a piece of work and there is no ticket for it (the session context says "Ticket: none"), ask first, before anything else.
  Use your AskUserQuestion tool (the user sees it as a choice card) with the question "Create a ticket for this work?" and these options:
  - "Create a Jira ticket": you draft it with the connected Jira tool; the user approves the exact draft before it is created.
  - "Use an existing ticket": the user gives the key.
  - "No ticket": use a short name for this work.
- Use AskUserQuestion for this one question only: one question, these options, nothing added. Every other question
  (behaviour, design, data) is a board decision posted with signoff post, never part of this card.
- When there is a key, run signoff register --ticket <KEY> and post your decisions under it.
- Never invent ticket keys. Questions and quick lookups are not work: do not ask about tickets for those.
