# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: modules.spec.ts >> Each module opens and does its job >> a fresh workspace can reach and use every sales module
- Location: tests\e2e\modules.spec.ts:55:7

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  getByRole('button', { name: 'celebrate' }).first()
Expected: "true"
Received: "false"
Timeout:  20000ms

Call log:
  - Expect "toHaveAttribute" with timeout 20000ms
  - waiting for getByRole('button', { name: 'celebrate' }).first()
    43 × locator resolved to <button type="button" aria-pressed="false" aria-label="celebrate" class="lf-btn lf-btn--secondary lf-btn--sm">🎉 0</button>
       - unexpected value "false"

```

```yaml
- button "celebrate": 🎉 0
```

# Test source

```ts
  86  |       const saved = await page.request.post('/api/v1/client-profiles', {
  87  |         data: { leadId, profession: 'Cardiologist', purchaseIntent: 'INVESTMENT', investmentCapacity: 2_500_000 },
  88  |       });
  89  |       expect(saved.status(), await saved.text()).toBeLessThan(300);
  90  | 
  91  |       await page.reload();
  92  |       await expect(page.getByText('Cardiologist')).toBeVisible();
  93  |     });
  94  | 
  95  |     await test.step('M6 — site visits open', async () => {
  96  |       await opens(page, '/site-visits', 'Site visits');
  97  |     });
  98  | 
  99  |     await test.step('M7 — the dialer and allocation open', async () => {
  100 |       await opens(page, '/calls', 'Calls');
  101 |       await opens(page, '/allocation', 'Allocation');
  102 | 
  103 |       // Asking for leads is the flow an agent actually performs.
  104 |       const asked = await page.request.post('/api/v1/allocation', {
  105 |         data: { action: 'ASK', requested: 5, reason: `Happy path ${run}` },
  106 |       });
  107 |       expect(asked.status(), await asked.text()).toBeLessThan(300);
  108 | 
  109 |       await page.reload();
  110 |       await expect(page.getByText(`Happy path ${run}`)).toBeVisible();
  111 |     });
  112 | 
  113 |     await test.step('M9 — commissions open, and a slab cannot pay until it is signed', async () => {
  114 |       await opens(page, '/commissions', 'Commissions');
  115 |       await opens(page, '/commissions/slabs', 'Commission slabs');
  116 | 
  117 |       // The module ships with no rates at all, so the page states that rather
  118 |       // than showing a table of zeroes.
  119 |       await expect(page.getByText('No commission rules yet')).toBeVisible();
  120 | 
  121 |       const drafted = await page.request.post('/api/v1/commission-slabs', {
  122 |         data: {
  123 |           name: `Standard ${run}`,
  124 |           mode: 'FLAT',
  125 |           basis: 'PERCENT_OF_SALE',
  126 |           effectiveFrom: new Date().toISOString(),
  127 |           bands: [{ fromAmount: 0, ratePct: 2 }],
  128 |         },
  129 |       });
  130 |       expect(drafted.status(), await drafted.text()).toBeLessThan(300);
  131 | 
  132 |       await page.reload();
  133 |       // The badge, not the header count — the same words appear in both, and a
  134 |       // loose match is ambiguous.
  135 |       await expect(page.getByText('awaiting finance', { exact: true })).toBeVisible();
  136 |       // Drafted, and visibly not yet usable: accrual ignores an unsigned slab.
  137 |       await expect(page.getByText('not used for any calculation')).toBeVisible();
  138 |     });
  139 | 
  140 |     await test.step('M10 — the leader dashboard opens with a funnel', async () => {
  141 |       await opens(page, '/leadership', 'Leadership');
  142 |       await expect(page.getByText('Funnel')).toBeVisible();
  143 |       await expect(page.getByRole('columnheader', { name: 'Arrived this period' })).toBeVisible();
  144 |     });
  145 | 
  146 |     await test.step('M10 — every report on the menu answers', async () => {
  147 |       await opens(page, '/reports', 'Reports');
  148 | 
  149 |       for (const [key, heading] of [
  150 |         ['lead-conversion', 'Lead conversion rate'],
  151 |         ['source-analysis', 'Source analysis'],
  152 |         ['team-performance', 'Team performance'],
  153 |       ] as const) {
  154 |         await page.goto(at(`/reports?report=${key}`));
  155 |         // These links used to omit the workspace slug and 404.
  156 |         await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  157 |       }
  158 | 
  159 |       const csv = await page.request.get('/api/v1/reports?report=source-analysis&format=csv');
  160 |       expect(csv.status()).toBe(200);
  161 |       expect(csv.headers()['content-type']).toContain('text/csv');
  162 |       // Every cell is quoted since the export moved onto the shared encoder.
  163 |       expect(await csv.text()).toContain('"Source","Leads"');
  164 |     });
  165 | 
  166 |     await test.step('M11 — somebody posts to the feed and reacts to it', async () => {
  167 |       await opens(page, '/engagement', 'Engagement');
  168 | 
  169 |       const body = `Closed the first one ${run}`;
  170 |       await page.getByRole('textbox').first().fill(body);
  171 | 
  172 |       const [posted] = await Promise.all([
  173 |         page.waitForResponse((r) => r.url().includes('/api/v1/posts') && r.request().method() === 'POST'),
  174 |         page.getByRole('button', { name: 'Post' }).click(),
  175 |       ]);
  176 |       expect(posted.status(), await posted.text()).toBeLessThan(300);
  177 | 
  178 |       await expect(page.getByText(body)).toBeVisible();
  179 | 
  180 |       // Reacting is the other half of a feed being a feed.
  181 |       const [reacted] = await Promise.all([
  182 |         page.waitForResponse((r) => r.url().includes('/api/v1/posts') && r.request().method() === 'PATCH'),
  183 |         page.getByRole('button', { name: 'celebrate' }).first().click(),
  184 |       ]);
  185 |       expect(reacted.status(), await reacted.text()).toBeLessThan(300);
> 186 |       await expect(page.getByRole('button', { name: 'celebrate' }).first()).toHaveAttribute('aria-pressed', 'true');
      |                                                                             ^ Error: expect(locator).toHaveAttribute(expected) failed
  187 |     });
  188 |   });
  189 | });
  190 | 
```