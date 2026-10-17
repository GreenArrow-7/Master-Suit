# Assignment rules can route by source, city or project

**17 Oct 2026** · feature · Lead Eagle, allocation (audit M7-03)

- A rule may carry conditions — sources, cities, projects of interest. A new lead goes to the first active rule, by position, whose conditions it meets; a rule with none takes any lead.
- Allocation → Automatic assignment: the new-rule form offers sources and cities, and each rule shows what it takes ("only Bayut, Dubai").
- `conditions` on `POST/PATCH /api/v1/distribution-rules`.
- Budget and language routing are not built: the lead carries no budget field, and nothing records an agent's languages.
- Test: `tests/sales/distribution-rules.spec.ts`.
