# Demo Project Scenario

## Scenario

Build a dispatch and appointment management system for a field service company.

## Suggested test flow

1. Create a new project called `Field Service Ops`.
2. Upload:
   - `../sample-inputs/field-service-brief.md`
   - `../sample-inputs/customer-feedback.md`
3. Ask the SA agent:

```text
Use the attached files to help define the product. We need a first release plan for a field service dispatch platform.
```

4. Answer the generated questionnaire.
5. Generate architecture.
6. Generate user stories.
7. Export using:
   - `/api/export/{thread_id}?format=markdown`
   - `/api/export/{thread_id}?format=json`
