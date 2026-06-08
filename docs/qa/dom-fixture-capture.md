# DOM Fixture Capture Notes

Real Power BI pages can be used to improve DOM fixture tests, but captured data must be sanitized before committing.

## Capture Rules

- Preserve DOM structure needed for filter discovery, selected state, search inputs, and clickable values.
- Replace report names with neutral labels such as "Report A".
- Replace filter names with neutral labels such as "Region", "Product", and "Segment".
- Replace values with neutral labels such as "Value A", "Value B", and "Value C".
- Remove business-specific text, IDs, account names, URLs, tokens, and tenant identifiers.
- Do not commit screenshots of corporate data.

## Fixture Review

Before committing a fixture:

1. Search for company, customer, product, tenant, and user names.
2. Search for email addresses and URLs.
3. Confirm selected-state attributes are still present.
4. Confirm tests pass with the sanitized fixture.
