# Poolday Policy Classes

Poolday sends prompts to browser providers.
Requesters must assume selected providers can see prompt text unless a separate private mode is added.

## Allowed Public Classes

- `public_text`
- `code_help`
- `benchmark_eval`

## Blocked Public Provider Classes

- `pii`
- `secrets`
- `medical_private`
- `illegal_content`

Provider adverts may include accepted policy classes.
Requester jobs must be classified before assignment.

## Minimum UI Disclosure

The requester UI should state:

```text
Public browser providers can see prompts selected for execution.
Do not submit secrets or private records.
```

*Last updated: June 2026*
