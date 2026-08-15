/**
 * Master Suite — demo CRM chain for the primary workspace.
 *
 * Everything downstream of a lead: accounts, contacts, a pipeline with
 * opportunities, calls with transcripts → AI analyses → scored audits,
 * follow-ups, targets, notifications, events, campaigns, communications,
 * forms and landing pages. Split from index.ts because it is pure record
 * generation — no tenants, roles or logins are created here.
 *
 * Runs on top-up seeds too (the lead guard in index.ts does not gate it), so
 * it re-reads leads and configuration from the database rather than trusting
 * in-memory state, and guards itself on the presence of any Account.
 */
import type { PrismaClient } from '@prisma/client';

export interface CrmCtx {
  tenantId: string;
  users: { id: string; role: string; name: string; email?: string; branch: string | null; teamCode: string | null }[];
  rnd: () => number;
  pick: <T>(xs: readonly T[]) => T;
  int: (min: number, max: number) => number;
  chance: (p: number) => boolean;
  businessDate: (daysBack: number) => Date;
}

// ── content pools: a Dubai brokerage's book of business ─────────────────────
const ACCOUNTS: [string, string, string][] = [
  // name, accountType, industry
  ['Marina Crest Properties', 'DEVELOPER', 'Real Estate'],
  ['Palm Gate Developments', 'DEVELOPER', 'Real Estate'],
  ['Skyline Estates Brokers', 'BROKERAGE', 'Real Estate'],
  ['Golden Sands Realty', 'BROKERAGE', 'Real Estate'],
  ['Creekside Property Group', 'DEVELOPER', 'Real Estate'],
  ['Oasis Towers Investments', 'INVESTOR', 'Financial Services'],
  ['Falcon Bay Holdings', 'INVESTOR', 'Financial Services'],
  ['Desert Rose Homes', 'DEVELOPER', 'Real Estate'],
  ['Pearl District Realty', 'BROKERAGE', 'Real Estate'],
  ['Harbour Point Estates', 'CORPORATE', 'Hospitality'],
  ['Sundial Properties', 'CORPORATE', 'Real Estate'],
  ['Crescent Peak Realty', 'BROKERAGE', 'Real Estate'],
];

const CONTACT_FIRST = ['Salim', 'Ingrid', 'Ravi', 'Dana', 'Khalid', 'Mei', 'Arjun', 'Lubna', 'Peter', 'Huda', 'Sanjay', 'Grace', 'Mansour', 'Olga'];
const CONTACT_LAST = ['Al Nuaimi', 'Bergström', 'Krishnan', 'Haroun', 'Bin Saeed', 'Tan', 'Kapoor', 'Aziz', 'Vermeer', 'Qassim', 'Rao', 'Mensah', 'Al Otaiba', 'Sokolova'];
const CONTACT_TITLES = ['Managing Director', 'Head of Acquisitions', 'Portfolio Manager', 'Investment Director', 'Sales Director', 'Chief Financial Officer', 'Development Manager', 'Partner'];

const PROJECTS = ['Marina Vista Residences', 'Creek Gate Towers', 'The Palm Crescent Collection', 'Downtown Skyline One', 'Hillside Terraces'];
const AREAS = ['Dubai Marina', 'Creek Harbour', 'Palm Jumeirah', 'Downtown Dubai', 'Dubai Hills'];
const BEDS = ['one-bedroom', 'two-bedroom', 'three-bedroom'];
const PRICES_M = ['1.2', '1.6', '2.1', '2.8', '3.4'];
const HANDOVERS = ['Q4 2027', 'Q1 2028', 'Q2 2028'];

/** Weights sum to 100, so a CallAudit's overallScore reads as a percentage. */
const CRITERIA: [string, number, boolean, string][] = [
  // label, weight, isRequired, description
  ['Greeting', 5, true, 'Opens with a professional greeting and states their own name and company.'],
  ['Introduction', 5, true, 'Confirms who they are speaking to and the reason for the call.'],
  ['Discovery', 15, true, 'Asks open questions about intent, timeline and current situation.'],
  ['Needs identification', 15, true, 'Establishes budget, preferred area and end-use vs investment.'],
  ['Product explanation', 10, false, 'Presents a matching project with price, payment plan and handover.'],
  ['Objection handling', 15, false, 'Acknowledges and answers objections without arguing.'],
  ['Communication clarity', 10, false, 'Speaks clearly, avoids jargon, checks understanding.'],
  ['Professionalism', 10, false, 'Courteous throughout; no pressure tactics.'],
  ['Compliance', 5, true, 'Discloses recording and respects consent and opt-outs.'],
  ['Closing & follow-up confirmation', 10, true, 'Agrees a concrete next step with a date and channel.'],
];

const FOLLOW_UP_TITLES = [
  'Send payment plan',
  'Share brochure',
  'Book site visit',
  'Send floor plans on WhatsApp',
  'Prepare offer letter',
  'Chase mortgage pre-approval',
  'Confirm cheque collection',
  'Schedule video call with spouse',
];

// per-criterion evidence quotes, timestamped the way the auditor formats them
const EVIDENCE: Record<string, string[]> = {
  Greeting: ['[00:04] "Good morning, this is {agent} calling from Manath Homes."'],
  Introduction: ['[00:11] "Am I speaking with {customer}?"', '[00:19] "You enquired about apartments earlier this week."'],
  Discovery: ['[01:02] "Is this for your own use or an investment?"', '[01:38] "What is drawing you to that area?"'],
  'Needs identification': ['[02:10] "Do you have a budget range in mind?"', '[02:41] "Somewhere around the budget the customer stated."'],
  'Product explanation': ['[03:22] "Units from that price with a 60/40 payment plan and handover as stated."'],
  'Objection handling': ['[04:15] "That is a fair concern — let me walk you through the escrow protections."'],
  'Communication clarity': ['[05:02] "Just to make sure I have this right…" — recaps the requirements accurately.'],
  Professionalism: ['[05:40] Customer interrupts twice; agent stays courteous and lets them finish.'],
  Compliance: ['[00:27] "This call is recorded for quality purposes, is that alright?"'],
  'Closing & follow-up confirmation': ['[06:12] "I will send the payment plan today and call you Thursday at 11:00."'],
};

export async function seedCrm(db: PrismaClient, ctx: CrmCtx) {
  const { tenantId, rnd, pick, int, chance, businessDate } = ctx;

  const existingAccounts = await db.account.count({ where: { tenantId } });
  if (existingAccounts > 0) {
    console.log('\n  CRM chain already present — skipping.');
    return;
  }

  // Read leads and config back from the database: on a top-up run the lead
  // generation block was skipped and index.ts holds no lead rows in memory.
  // Ordered by reference so pick() draws the same rows for the same SEED_KEY.
  const leads = await db.lead.findMany({
    where: { tenantId },
    select: { id: true, ownerId: true, stageId: true, fullName: true, firstName: true, email: true, phone: true },
    orderBy: { reference: 'asc' },
  });
  const stages = await db.leadStage.findMany({ where: { tenantId }, select: { id: true, key: true } });
  const products = await db.product.findMany({
    where: { tenantId, category: { in: ['Off-plan', 'Ready'] } },
    select: { id: true, name: true },
    orderBy: { code: 'asc' },
  });
  const convertedStageId = stages.find((s) => s.key === 'converted')?.id;
  const assignedLeads = leads.filter((l) => l.ownerId);
  const convertedLeads = leads.filter((l) => l.stageId === convertedStageId);
  if (assignedLeads.length === 0) {
    console.log('\n  No assigned leads to build the CRM chain on — skipping.');
    return;
  }

  const reps = ctx.users.filter((u) => u.role === 'sales_rep');
  const managers = ctx.users.filter((u) => u.role === 'team_manager');
  const sellers = [...reps, ...managers];
  const orgAdmin = ctx.users.find((u) => u.role === 'org_admin')!;
  const director = ctx.users.find((u) => u.role === 'sales_director')!;
  const marketer = ctx.users.find((u) => u.role === 'marketing_manager') ?? director;

  const now = Date.now();
  const mobile = () => `+9715${pick(['0', '2', '4', '5', '6'])}${String(int(1000000, 9999999))}`;
  const landline = () => `+9714${String(int(2000000, 3999999))}`;
  const future = (minDays: number, maxDays: number, hour: number) => {
    const d = new Date(now + int(minDays, maxDays) * 864e5);
    d.setHours(hour, int(0, 59), 0, 0);
    return d;
  };
  /** Today regardless of weekday — businessDate() walks Fri/Sat back a day,
   *  which would zero the "Today's Calls" metric on a weekend demo. */
  const todayAt = (hour: number) => {
    const d = new Date();
    d.setHours(hour, int(0, 59), int(0, 59), 0);
    return d;
  };

  // 1. Accounts ──────────────────────────────────────────────────────────────
  const accountRows = ACCOUNTS.map(([name, accountType, industry], i) => {
    const domain = name.toLowerCase().replace(/[^a-z]/g, '') + '.ae';
    const owner = sellers[i % sellers.length]!;
    return {
      tenantId,
      reference: `AC-${String(i + 1).padStart(6, '0')}`,
      name,
      accountType,
      industry,
      website: `https://${domain}`,
      mainPhone: landline(),
      mainEmail: `info@${domain}`,
      billingAddress: {
        line1: `Office ${int(101, 3904)}, ${pick(['Bay Square', 'Marina Plaza', 'Emirates Towers Boulevard', 'Index Tower', 'The Opus'])}`,
        city: pick(['Dubai', 'Abu Dhabi', 'Sharjah']),
        country: 'AE',
      },
      ownerId: owner.id,
      employeeCount: int(8, 450),
      annualRevenue: int(4, 220) * 1_000_000,
      status: 'ACTIVE',
      customerTier: pick(['PLATINUM', 'GOLD', 'SILVER']),
      tags: chance(0.4) ? [pick(['developer', 'repeat-buyer', 'institutional'])] : [],
      createdAt: businessDate(90),
    };
  });
  await db.account.createMany({ data: accountRows });
  const accounts = await db.account.findMany({
    where: { tenantId },
    select: { id: true, name: true, ownerId: true },
    orderBy: { reference: 'asc' },
  });

  // 2. Contacts ──────────────────────────────────────────────────────────────
  const contactRows = Array.from({ length: 25 }, (_, i) => {
    const first = pick(CONTACT_FIRST);
    const last = pick(CONTACT_LAST);
    const account = accounts[i % accounts.length]!;
    const domain = account.name.toLowerCase().replace(/[^a-z]/g, '') + '.ae';
    const cell = mobile();
    return {
      tenantId,
      reference: `CT-${String(i + 1).padStart(6, '0')}`,
      firstName: first,
      lastName: last,
      fullName: `${first} ${last}`,
      jobTitle: pick(CONTACT_TITLES),
      email: `${first.toLowerCase().replace(/[^a-z]/g, '')}.${last.toLowerCase().replace(/[^a-z]/g, '')}@${domain}`,
      phone: cell,
      phoneNormalized: cell,
      accountId: account.id,
      decisionRole: pick(['DECISION_MAKER', 'INFLUENCER', 'CHAMPION', 'GATEKEEPER']),
      ownerId: account.ownerId,
      consentStatus: chance(0.8) ? ('GRANTED' as const) : ('UNKNOWN' as const),
      createdAt: businessDate(90),
    };
  });
  await db.contact.createMany({ data: contactRows });
  const contacts = await db.contact.findMany({
    where: { tenantId },
    select: { id: true, fullName: true, email: true, phone: true, accountId: true, ownerId: true },
    orderBy: { reference: 'asc' },
  });

  // 3. Pipeline ──────────────────────────────────────────────────────────────
  const pipeline = await db.pipeline.create({
    data: { tenantId, key: 'sales', name: 'Sales Pipeline', isDefault: true },
  });
  const PIPELINE_STAGES = [
    ['qualification', 'Qualification', 'OPEN', '#3D6BC7', 10],
    ['needs_analysis', 'Needs Analysis', 'OPEN', '#2447C7', 25],
    ['proposal', 'Proposal', 'OPEN', '#8A5A1A', 50],
    ['negotiation', 'Negotiation', 'OPEN', '#6E4B12', 70],
    ['closed_won', 'Closed Won', 'CONVERSION', '#0B6E5A', 100],
    ['closed_lost', 'Closed Lost', 'TERMINAL_NEGATIVE', '#A8232B', 0],
  ] as const;
  const pipelineStages = new Map<string, string>();
  for (let i = 0; i < PIPELINE_STAGES.length; i++) {
    const [key, name, category, color, probability] = PIPELINE_STAGES[i]!;
    const s = await db.pipelineStage.create({
      data: { tenantId, pipelineId: pipeline.id, key, name, category, color, position: i, probability },
    });
    pipelineStages.set(key, s.id);
  }

  // 4. Loss reasons ──────────────────────────────────────────────────────────
  const LOSS_REASONS = ['Price too high', 'Chose competitor', 'Financing declined', 'Project delayed'];
  await db.lossReason.createMany({
    data: LOSS_REASONS.map((name, i) => ({ tenantId, name, position: i })),
    skipDuplicates: true,
  });
  const lossReasons = await db.lossReason.findMany({ where: { tenantId }, orderBy: { position: 'asc' } });

  // 5. Opportunities ─────────────────────────────────────────────────────────
  // 8 open across the four working stages, 4 won, 2 lost — the won ones
  // trace back to converted leads so the lead → deal chain is walkable.
  const oppStageKeys = [
    'qualification', 'qualification', 'needs_analysis', 'needs_analysis',
    'proposal', 'proposal', 'negotiation', 'negotiation',
    'closed_won', 'closed_won', 'closed_won', 'closed_won',
    'closed_lost', 'closed_lost',
  ];
  const oppRows: any[] = [];
  for (let i = 0; i < oppStageKeys.length; i++) {
    const stageKey = oppStageKeys[i]!;
    const spec = PIPELINE_STAGES.find((s) => s[0] === stageKey)!;
    const status = stageKey === 'closed_won' ? 'WON' : stageKey === 'closed_lost' ? 'LOST' : 'OPEN';
    const contact = contacts[i]!;
    const account = accounts.find((a) => a.id === contact.accountId)!;
    const product = pick(products);
    const amount = int(10, 180) * 25_000; // 250k – 4.5M AED
    const createdAt = businessDate(90);
    const closed = status !== 'OPEN';
    const lead = status === 'WON' ? convertedLeads[i - 8] : undefined;
    const lost = status === 'LOST' ? lossReasons[i - 12] : undefined;
    oppRows.push({
      tenantId,
      reference: `OP-${String(i + 1).padStart(6, '0')}`,
      name: `${account.name} — ${product.name}`,
      leadId: lead?.id ?? null,
      accountId: account.id,
      contactId: contact.id,
      productId: product.id,
      pipelineId: pipeline.id,
      stageId: pipelineStages.get(stageKey)!,
      status,
      ownerId: account.ownerId,
      amount,
      currency: 'AED',
      expectedRevenue: Math.round((amount * spec[4]) / 100),
      probability: spec[4],
      expectedCloseDate: closed ? businessDate(45) : future(7, 75, 17),
      actualCloseDate: closed ? businessDate(30) : null,
      source: 'MANUAL',
      lossReasonId: lost?.id ?? null,
      lossNotes: lost ? `Lost to ${lost.name.toLowerCase()} after final round.` : null,
      notes: chance(0.4) ? pick(['Decision expected after board meeting.', 'Wants two parking bays included.', 'Comparing with a Creek Harbour launch.']) : null,
      stageEnteredAt: businessDate(21),
      createdAt,
    });
  }
  await db.opportunity.createMany({ data: oppRows });
  // Close the loop on the converted leads the won deals came from.
  for (let i = 0; i < 4; i++) {
    const lead = convertedLeads[i];
    const opp = oppRows[8 + i];
    if (!lead || !opp.leadId) continue;
    await db.lead.update({
      where: { id: lead.id },
      data: { accountId: opp.accountId, convertedContactId: opp.contactId },
    });
  }

  // 6. Audit scorecard ───────────────────────────────────────────────────────
  const scorecard = await db.auditScorecard.create({
    data: {
      tenantId,
      name: 'Sales Call Quality v1',
      isActive: true,
      criteria: {
        create: CRITERIA.map(([label, weight, isRequired, description], i) => ({
          tenantId, label, weight, isRequired, description, position: i,
        })),
      },
    },
  });

  // 7. Campaigns ─────────────────────────────────────────────────────────────
  const running = await db.campaign.create({
    data: {
      tenantId,
      name: 'Marina Vista Off-Plan Calling',
      code: 'CALL-MARINA-26',
      campaignType: 'CALLING',
      channel: 'VOICE',
      ownerId: marketer.id,
      status: 'RUNNING',
      startDate: new Date(now - 14 * 864e5),
      endDate: new Date(now + 30 * 864e5),
      budget: 60_000,
      actualSpend: 21_500,
      expectedLeads: 120,
      utmSource: 'callcenter',
      utmMedium: 'voice',
      utmCampaign: 'marina-vista-launch',
    },
  });
  const script = await db.campaignScript.create({
    data: {
      tenantId,
      campaignId: running.id,
      title: 'Marina Vista launch script',
      isDefault: true,
      content: [
        'Good morning/afternoon, this is {agent} calling from Manath Homes.',
        'Confirm the contact, disclose recording, and ask for two minutes.',
        'Discovery: end use or investment, budget band, preferred area, timeline.',
        'Pitch Marina Vista Residences: from AED 1.2M, 60/40 payment plan, Q4 2027 handover.',
        'Handle objections from the talking points. Never quote yields as guaranteed.',
        'Close on a concrete next step: site visit, brochure by email, or a booked callback.',
      ].join('\n'),
    },
  });
  await db.campaignTalkingPoint.createMany({
    data: [
      { tenantId, campaignId: running.id, scriptId: script.id, label: '60/40 payment plan', description: '40% due only on handover — lead with affordability.', isRequired: true, position: 0 },
      { tenantId, campaignId: running.id, scriptId: script.id, label: 'Projected 7–8% rental yield', description: 'Always say "projected", never "guaranteed".', isRequired: true, position: 1 },
      { tenantId, campaignId: running.id, scriptId: script.id, label: 'Q4 2027 handover', description: 'Escrow-protected construction milestones.', isRequired: false, position: 2 },
    ],
  });
  await db.campaignMember.createMany({
    data: reps.slice(0, 4).map((r) => ({ tenantId, campaignId: running.id, userId: r.id, role: 'CALLER' })),
  });
  // No CampaignContact model exists — leads join a campaign via Lead.campaignId.
  const campaignLeads = assignedLeads.slice(0, 10);
  await db.lead.updateMany({
    where: { id: { in: campaignLeads.map((l) => l.id) }, tenantId },
    data: { campaignId: running.id },
  });
  await db.campaign.create({
    data: {
      tenantId,
      name: 'Spring Ready-Home Push',
      code: 'CALL-SPRING-26',
      campaignType: 'CALLING',
      channel: 'VOICE',
      ownerId: marketer.id,
      status: 'COMPLETED',
      startDate: new Date(now - 75 * 864e5),
      endDate: new Date(now - 40 * 864e5),
      budget: 45_000,
      actualSpend: 43_200,
      expectedLeads: 90,
    },
  });
  await db.campaign.create({
    data: {
      tenantId,
      name: 'Downtown Penthouse Waitlist',
      code: 'CALL-PENTHOUSE-26',
      campaignType: 'CALLING',
      channel: 'VOICE',
      ownerId: marketer.id,
      status: 'DRAFT',
      expectedLeads: 40,
    },
  });

  // 8. Calls ─────────────────────────────────────────────────────────────────
  // 15 completed (5 today), 4 missed (2 today), 2 failed, 4 scheduled ahead —
  // so Today's Calls, the outcome mix and the upcoming queue all have data.
  type CallRow = { id: string; leadId: string | null; contactName: string; callerName: string; outcome: string | null };
  const callRows: CallRow[] = [];
  const completedOutcomes = ['CONNECTED', 'INTERESTED', 'QUALIFIED', 'CALLBACK_REQUESTED', 'NOT_INTERESTED', 'VOICEMAIL', 'CONVERTED'] as const;
  for (let i = 0; i < 25; i++) {
    const caller = sellers[i % sellers.length]!;
    const onContact = i % 5 === 4; // every fifth call targets an account contact
    const lead = assignedLeads[(i * 7) % assignedLeads.length]!;
    const contact = contacts[i % contacts.length]!;
    const who = onContact ? contact.fullName : lead.fullName;
    const number = (onContact ? contact.phone : lead.phone) ?? mobile();

    let status: 'COMPLETED' | 'MISSED' | 'FAILED' | 'SCHEDULED';
    if (i < 15) status = 'COMPLETED';
    else if (i < 19) status = 'MISSED';
    else if (i < 21) status = 'FAILED';
    else status = 'SCHEDULED';

    const isToday = (status === 'COMPLETED' && i < 5) || (status === 'MISSED' && i < 17);
    const startedAt =
      status === 'SCHEDULED' ? future(1, 5, int(10, 17)) : isToday ? todayAt(int(9, 12)) : businessDate(14);
    const durationSecs = status === 'COMPLETED' ? int(120, 900) : null;
    const outcome =
      status === 'COMPLETED'
        ? completedOutcomes[i % completedOutcomes.length]!
        : status === 'MISSED'
          ? pick(['NO_ANSWER', 'BUSY'] as const)
          : status === 'FAILED' && i === 20
            ? 'WRONG_NUMBER'
            : null;

    const call = await db.call.create({
      data: {
        tenantId,
        leadId: onContact ? null : lead.id,
        contactId: onContact ? contact.id : null,
        accountId: onContact ? contact.accountId : null,
        campaignId: i < 8 ? running.id : null,
        callerId: caller.id,
        direction: chance(0.8) ? 'OUTBOUND' : 'INBOUND',
        status,
        outcome,
        callerNumber: '+97144480300',
        recipientNumber: number,
        startedAt,
        answeredAt: status === 'COMPLETED' ? new Date(startedAt.getTime() + int(4, 18) * 1000) : null,
        endedAt: durationSecs ? new Date(startedAt.getTime() + durationSecs * 1000) : null,
        durationSecs,
        notes: status === 'FAILED' ? 'Provider error — number unreachable.' : null,
        followUpAt: outcome === 'CALLBACK_REQUESTED' ? future(1, 3, 11) : null,
        createdAt: status === 'SCHEDULED' ? new Date() : startedAt,
      },
    });
    callRows.push({ id: call.id, leadId: onContact ? null : lead.id, contactName: who, callerName: caller.name, outcome });
  }

  // 9. Consent + transcripts for the first 10 completed calls ────────────────
  const spoken = callRows.slice(0, 10);
  const transcriptMeta: { call: CallRow; project: string; area: string; beds: string; priceM: string; handover: string }[] = [];
  for (const call of spoken) {
    const meta = {
      call,
      project: pick(PROJECTS),
      area: pick(AREAS),
      beds: pick(BEDS),
      priceM: pick(PRICES_M),
      handover: pick(HANDOVERS),
    };
    transcriptMeta.push(meta);
    await db.recordingConsent.create({
      data: {
        tenantId,
        callId: call.id,
        consentGiven: true,
        method: 'VERBAL',
        consentedBy: call.contactName,
        givenAt: businessDate(14),
      },
    });
    const content = makeTranscript(ctx, call.callerName, call.contactName, meta);
    await db.transcript.create({
      data: {
        tenantId,
        callId: call.id,
        content,
        language: 'en',
        provider: 'demo',
        confidence: Math.round((0.86 + rnd() * 0.12) * 100) / 100,
        wordCount: content.split(/\s+/).filter(Boolean).length,
      },
    });
  }

  // 10. AI analyses for 8 of those ───────────────────────────────────────────
  for (let i = 0; i < 8; i++) {
    const m = transcriptMeta[i]!;
    const positive = m.call.outcome !== 'NOT_INTERESTED';
    await db.aIAnalysis.create({
      data: {
        tenantId,
        callId: m.call.id,
        status: 'COMPLETED',
        modelId: 'demo-seed-analysis',
        processingMs: int(4000, 14000),
        summary:
          `${m.call.contactName} enquired about ${m.beds} units at ${m.project}, ${m.area}, with a budget around AED ${m.priceM}M. ` +
          (positive
            ? `The customer responded well to the payment plan and agreed a concrete next step with ${m.call.callerName}.`
            : `The customer is not proceeding at this time; price was the main blocker and no next step was agreed.`),
        clientNeeds: [
          `${m.beds[0]!.toUpperCase()}${m.beds.slice(1)} apartment in ${m.area}`,
          pick(['Rental yield above 7%', 'Handover before 2028', 'Waterfront or skyline view', 'Post-handover payment flexibility']),
        ],
        objections: positive
          ? [pick(['Concerned about service charges', 'Wants to compare with a competing launch', 'Prefers a higher floor than currently released'])]
          : ['Price above stated budget', 'Prefers ready property over off-plan'],
        commitments: positive
          ? [`${m.call.callerName} to send the payment plan by email today`, 'Customer agreed to a follow-up call this week']
          : [],
        buyingSignals: positive
          ? [pick(['Asked whether the booking amount is refundable', 'Asked about unit availability on higher floors', 'Requested the payment schedule in writing'])]
          : [],
        risks: [pick(['Customer is also speaking to two other brokers', 'Financing is not yet pre-approved', 'Decision depends on a partner who was not on the call'])],
        nextSteps: positive
          ? ['Send brochure and payment plan', pick(['Book a site visit for the weekend', 'Follow up Thursday at 11:00', 'Share floor plans on WhatsApp'])]
          : ['Move to nurture list; re-contact at the next price release'],
        topicsDiscussed: ['Budget', 'Payment plan', 'Location', 'Handover date'],
        topicsMissed: [pick(['Service charges', 'Mortgage options', 'Snagging and handover process'])],
        sentiment: positive ? pick(['positive', 'neutral']) : 'negative',
        sentimentScore: positive ? Math.round((0.55 + rnd() * 0.4) * 100) / 100 : Math.round((0.1 + rnd() * 0.25) * 100) / 100,
        suggestedStatus: m.call.outcome,
        complianceFlags: i === 6 ? ['Recording disclosure came late in the call'] : [],
        uncertainItems: chance(0.5) ? ['Exact handover quarter mentioned by the customer was unclear'] : [],
      },
    });
  }

  // 11. Call audits for 6 of the analysed calls ──────────────────────────────
  for (let i = 0; i < 6; i++) {
    const m = transcriptMeta[i]!;
    const band = 0.55 + (i / 5) * 0.4; // spreads overall scores ≈55 → 95
    const criteriaScores = CRITERIA.map(([label, weight]) => {
      const factor = Math.min(1, Math.max(0.3, band + (rnd() - 0.5) * 0.2));
      const score = Math.round(weight * factor * 10) / 10;
      const evidence = pick(EVIDENCE[label]!)
        .replace('{agent}', m.call.callerName)
        .replace('{customer}', m.call.contactName);
      return { label, score, maxScore: weight, met: score >= weight * 0.6, evidence };
    });
    const overallScore = Math.round(criteriaScores.reduce((s, c) => s + c.score, 0) * 10) / 10;
    await db.callAudit.create({
      data: {
        tenantId,
        callId: m.call.id,
        scorecardId: scorecard.id,
        status: 'COMPLETED',
        overallScore,
        maxScore: 100,
        criteriaScores,
        missedPoints: criteriaScores.filter((c) => !c.met).map((c) => `${c.label} was not clearly addressed`),
        strengths: [
          pick(['Warm, confident opening', 'Strong discovery questions', 'Clear explanation of the payment plan']),
          pick(['Kept control of the call politely', 'Recapped the customer requirements accurately']),
        ],
        risks: overallScore < 70 ? ['Yield was mentioned without the word "projected"'] : [],
        suggestions: [
          pick(['Confirm budget earlier in the call', 'Offer two concrete slots when proposing a site visit', 'Slow down when quoting figures']),
        ],
        nextAction: pick(['Send the payment plan and book the site visit', 'Schedule a coaching review of the objection segment', 'Call back Thursday as agreed']),
        humanReviewed: i < 2,
        reviewedById: i < 2 ? director.id : null,
        reviewedAt: i < 2 ? businessDate(5) : null,
      },
    });
  }

  // 12. Follow-up tasks ──────────────────────────────────────────────────────
  const followUpRows: any[] = [];
  const followUpBuckets: ['OPEN' | 'COMPLETED', number, (i: number) => Date][] = [
    ['OPEN', 8, () => new Date(now - int(1, 10) * 864e5)], // overdue
    ['OPEN', 6, () => todayAt(int(9, 20))], // due today
    ['OPEN', 12, () => future(1, 7, int(9, 18))], // this week
    ['COMPLETED', 4, () => new Date(now - int(2, 12) * 864e5)],
  ];
  let followUpIx = 0;
  for (const [status, count, due] of followUpBuckets) {
    for (let i = 0; i < count; i++) {
      const lead = assignedLeads[(followUpIx * 11) % assignedLeads.length]!;
      const call = followUpIx % 3 === 0 ? callRows[followUpIx % callRows.length] : null;
      const dueAt = due(i);
      followUpRows.push({
        tenantId,
        leadId: lead.id,
        callId: call?.id ?? null,
        ownerId: reps[followUpIx % reps.length]!.id,
        title: FOLLOW_UP_TITLES[followUpIx % FOLLOW_UP_TITLES.length]!,
        description: chance(0.4) ? `Requested during the last conversation with ${lead.fullName}.` : null,
        dueAt,
        priority: pick(['LOW', 'MEDIUM', 'MEDIUM', 'HIGH', 'URGENT'] as const),
        status,
        completedAt: status === 'COMPLETED' ? new Date(dueAt.getTime() + int(1, 8) * 36e5) : null,
        outcome: status === 'COMPLETED' ? 'Done' : null,
      });
      followUpIx++;
    }
  }
  await db.followUpTask.createMany({ data: followUpRows });

  // 13. Targets ──────────────────────────────────────────────────────────────
  // Current month for all 12 sellers (progress 30–90%), an upcoming month for
  // four, a finished month for another four. Progress rows use the same
  // dateKey arithmetic as the targets page: ISO date strings inside the period.
  const METRICS: ['CALLS_CONNECTED' | 'LEADS_CONVERTED' | 'FOLLOWUPS_COMPLETED', number][] = [
    ['CALLS_CONNECTED', 60],
    ['LEADS_CONVERTED', 8],
    ['FOLLOWUPS_COMPLETED', 40],
  ];
  const monthStart = (offset: number) => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() + offset, 1);
  };
  const monthEnd = (offset: number) => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() + offset + 1, 0, 23, 59, 59);
  };
  // Noon avoids the UTC-conversion date shift for any timezone within ±12h.
  const dayKey = (base: Date, day: number) =>
    new Date(base.getFullYear(), base.getMonth(), day, 12).toISOString().slice(0, 10);

  let targetCount = 0;
  const writeProgress = async (targetId: string, userId: string, base: Date, days: number[], total: number) => {
    const per = Math.floor(total / days.length);
    await db.targetProgress.createMany({
      data: days.map((day, j) => ({
        tenantId,
        targetId,
        userId,
        dateKey: dayKey(base, day),
        achieved: j === 0 ? total - per * (days.length - 1) : per,
      })),
    });
  };

  for (let i = 0; i < sellers.length; i++) {
    const seller = sellers[i]!;
    const [metric, targetValue] = METRICS[i % METRICS.length]!;

    // current month, 30–90% done
    const current = await db.employeeTarget.create({
      data: {
        tenantId, userId: seller.id, metric, period: 'MONTHLY',
        targetValue, periodStart: monthStart(0), periodEnd: monthEnd(0),
      },
    });
    targetCount++;
    const dom = Math.max(1, new Date().getDate());
    const days = [...new Set([1, Math.ceil(dom / 2), dom])];
    await writeProgress(current.id, seller.id, monthStart(0), days, Math.max(1, Math.round((targetValue * int(30, 90)) / 100)));

    if (i < 4) {
      // next month, planned, nothing achieved yet
      await db.employeeTarget.create({
        data: {
          tenantId, userId: seller.id, metric, period: 'MONTHLY',
          targetValue, periodStart: monthStart(1), periodEnd: monthEnd(1),
        },
      });
      targetCount++;
    } else if (i < 8) {
      // last month, finished at or above target
      const past = await db.employeeTarget.create({
        data: {
          tenantId, userId: seller.id, metric, period: 'MONTHLY',
          targetValue, periodStart: monthStart(-1), periodEnd: monthEnd(-1),
        },
      });
      targetCount++;
      await writeProgress(past.id, seller.id, monthStart(-1), [2, 9, 16, 23], targetValue + int(0, 5));
    }
  }

  // 14. Notifications ────────────────────────────────────────────────────────
  const recipients = [orgAdmin, director, reps[0]!, reps[1]!, reps[2]!];
  const notificationRows: any[] = [];
  for (let i = 0; i < 20; i++) {
    const user = recipients[i % recipients.length]!;
    const lead = assignedLeads[(i * 13) % assignedLeads.length]!;
    const kind = pick(['LEAD_ASSIGNED', 'TASK_OVERDUE', 'SLA_BREACHED', 'TARGET_PROGRESS', 'CALL_MISSED'] as const);
    const spec: Record<typeof kind, { title: string; body: string; objectType: string | null; priority: 'MEDIUM' | 'HIGH' | 'URGENT' }> = {
      LEAD_ASSIGNED: { title: 'New lead assigned', body: `${lead.fullName} was assigned to you.`, objectType: 'leads', priority: 'MEDIUM' },
      TASK_OVERDUE: { title: 'Follow-up overdue', body: `"${pick(FOLLOW_UP_TITLES)}" for ${lead.fullName} is past due.`, objectType: 'tasks', priority: 'HIGH' },
      SLA_BREACHED: { title: 'SLA breached', body: `First contact for ${lead.fullName} has breached its SLA.`, objectType: 'leads', priority: 'URGENT' },
      TARGET_PROGRESS: { title: 'Target update', body: `You are at ${int(30, 90)}% of your monthly target.`, objectType: null, priority: 'MEDIUM' },
      CALL_MISSED: { title: 'Missed call', body: `Missed call from ${lead.fullName} (${lead.phone ?? 'unknown number'}).`, objectType: 'calls', priority: 'MEDIUM' },
    };
    const createdAt = businessDate(4);
    notificationRows.push({
      tenantId,
      userId: user.id,
      kind,
      title: spec[kind].title,
      body: spec[kind].body,
      objectType: spec[kind].objectType,
      recordId: spec[kind].objectType === 'leads' ? lead.id : null,
      priority: spec[kind].priority,
      readAt: i % 2 === 0 ? null : new Date(createdAt.getTime() + int(1, 6) * 36e5),
      createdAt,
    });
  }
  await db.notification.createMany({ data: notificationRows });

  // 15. Events ───────────────────────────────────────────────────────────────
  const eventSpecs: [string, 'PHYSICAL' | 'ONLINE' | 'HYBRID', boolean, string][] = [
    // title, type, isPast, location
    ['Marina Vista Open House', 'PHYSICAL', true, 'Marina Vista Sales Centre, Dubai Marina'],
    ['Downtown Penthouse Private Viewing', 'PHYSICAL', true, 'Downtown Skyline One, Downtown Dubai'],
    ['Ramadan Investor Majlis', 'PHYSICAL', true, 'Manath Homes HQ, Business Bay'],
    ['Creek Gate Project Launch', 'PHYSICAL', false, 'Creek Gate Pavilion, Creek Harbour'],
    ['Investing in Dubai Off-Plan — Webinar', 'ONLINE', false, 'Online'],
    ['Broker Partner Briefing', 'HYBRID', false, 'Manath Homes HQ, Business Bay'],
  ];
  let inviteeCount = 0;
  for (let e = 0; e < eventSpecs.length; e++) {
    const [title, eventType, isPast, location] = eventSpecs[e]!;
    const startAt = isPast ? businessDate(45) : future(3, 21, int(10, 18));
    const endAt = new Date(startAt.getTime() + 2 * 36e5);
    const invitees = leads.slice(e * 5, e * 5 + int(3, 5));
    const event = await db.event.create({
      data: {
        tenantId,
        title,
        description: `${title} hosted by Manath Homes.`,
        eventType,
        status: isPast ? 'COMPLETED' : 'PUBLISHED',
        startAt,
        endAt,
        hostId: managers[e % managers.length]!.id,
        location,
        address: eventType === 'ONLINE' ? null : location,
        meetingUrl: eventType === 'PHYSICAL' ? null : 'https://meet.manathhomes.ae/demo',
        capacity: int(20, 120),
        registeredCount: invitees.length,
        attendedCount: isPast ? Math.max(1, invitees.length - 1) : 0,
      },
    });
    await db.eventInvitee.createMany({
      data: invitees.map((lead, j) => {
        const rsvpStatus = isPast
          ? j === 0 ? ('NO_SHOW' as const) : ('ATTENDED' as const)
          : pick(['CONFIRMED', 'PENDING', 'TENTATIVE'] as const);
        return {
          tenantId,
          eventId: event.id,
          leadId: lead.id,
          name: lead.fullName,
          email: lead.email,
          phone: lead.phone,
          rsvpStatus,
          rsvpAt: rsvpStatus === 'PENDING' ? null : businessDate(10),
          rsvpChannel: rsvpStatus === 'PENDING' ? null : pick(['EMAIL', 'WHATSAPP'] as const),
          invitedAt: new Date(startAt.getTime() - int(7, 14) * 864e5),
          inviteChannel: pick(['EMAIL', 'WHATSAPP'] as const),
          inviteSentAt: new Date(startAt.getTime() - int(7, 14) * 864e5),
          inviteDelivered: true,
          checkedInAt: rsvpStatus === 'ATTENDED' ? startAt : null,
        };
      }),
    });
    inviteeCount += invitees.length;
  }

  // 16. Communications ───────────────────────────────────────────────────────
  const commRows: any[] = [];
  for (let i = 0; i < 30; i++) {
    const channel = (['EMAIL', 'EMAIL', 'EMAIL', 'WHATSAPP', 'WHATSAPP', 'SMS', 'VOICE'] as const)[i % 7]!;
    const onContact = i % 6 === 5;
    const lead = assignedLeads[(i * 17) % assignedLeads.length]!;
    const contact = contacts[i % contacts.length]!;
    const status =
      i === 27 ? 'FAILED' : i === 28 ? 'FAILED' : i === 29 ? 'BOUNCED'
        : pick(['SENT', 'DELIVERED', 'DELIVERED', 'READ', 'REPLIED'] as const);
    const direction = chance(0.75) ? 'OUTBOUND' : 'INBOUND';
    const sentAt = businessDate(30);
    const delivered = status !== 'FAILED' && status !== 'BOUNCED';
    commRows.push({
      tenantId,
      channel: i === 29 ? 'EMAIL' : channel, // the bounce is an email bounce
      direction,
      status,
      leadId: onContact ? null : lead.id,
      contactId: onContact ? contact.id : null,
      accountId: onContact ? contact.accountId : null,
      fromAddress: channel === 'EMAIL' ? 'sales@manathhomes.ae' : '+97144480300',
      toAddress:
        channel === 'EMAIL' || i === 29
          ? ((onContact ? contact.email : lead.email) ?? 'unknown@example.com')
          : ((onContact ? contact.phone : lead.phone) ?? mobile()),
      subject: channel === 'EMAIL' ? pick(['Marina Vista payment plan', 'Your site visit is confirmed', 'Floor plans as requested', 'Following up on our call']) : null,
      body: pick([
        'Sharing the payment plan we discussed — 60/40 with handover Q4 2027.',
        'Confirming your site visit for Saturday at 11:00. See you at the sales centre.',
        'Floor plans attached for the two-bedroom units. Let me know which you prefer.',
        'Thanks for your time today — summary of next steps inside.',
      ]),
      errorCode: status === 'FAILED' ? 'ERR_PROVIDER' : status === 'BOUNCED' ? 'HARD_BOUNCE' : null,
      errorMessage: status === 'FAILED' ? 'Provider rejected the message.' : status === 'BOUNCED' ? 'Mailbox does not exist.' : null,
      queuedAt: sentAt,
      sentAt: delivered ? sentAt : null,
      deliveredAt: delivered ? new Date(sentAt.getTime() + 60_000) : null,
      openedAt: status === 'READ' || status === 'REPLIED' ? new Date(sentAt.getTime() + int(5, 180) * 60_000) : null,
      repliedAt: status === 'REPLIED' ? new Date(sentAt.getTime() + int(10, 360) * 60_000) : null,
      callDisposition: channel === 'VOICE' ? pick(['Connected', 'Voicemail', 'No answer']) : null,
      durationSecs: channel === 'VOICE' ? int(60, 600) : null,
      ownerId: sellers[i % sellers.length]!.id,
      createdAt: sentAt,
    });
  }
  await db.communication.createMany({ data: commRows });

  // 17. Forms ────────────────────────────────────────────────────────────────
  const enquiryForm = await db.form.create({
    data: {
      tenantId,
      key: 'property-enquiry',
      name: 'Property Enquiry',
      purpose: 'LEAD_CAPTURE',
      targetObject: 'LEAD',
      state: 'PUBLISHED',
      isPublic: true,
      successMessage: 'Thank you — a consultant will call you within one business day.',
      fields: {
        create: [
          { tenantId, key: 'full_name', label: 'Full name', type: 'TEXT' as const, position: 0, isRequired: true, mapsToField: 'fullName' },
          { tenantId, key: 'phone', label: 'Phone', type: 'PHONE' as const, position: 1, isRequired: true, mapsToField: 'phone' },
          { tenantId, key: 'email', label: 'Email', type: 'EMAIL' as const, position: 2, isRequired: true, mapsToField: 'email' },
          { tenantId, key: 'message', label: 'What are you looking for?', type: 'LONG_TEXT' as const, position: 3, isRequired: false },
          {
            tenantId, key: 'budget_range', label: 'Budget range', type: 'DROPDOWN' as const, position: 4, isRequired: false,
            options: { choices: ['Under AED 1M', 'AED 1M – 2M', 'AED 2M – 4M', 'Above AED 4M'] },
          },
        ],
      },
    },
  });
  const budgetChoices = ['Under AED 1M', 'AED 1M – 2M', 'AED 2M – 4M', 'Above AED 4M'];
  await db.formSubmission.createMany({
    data: Array.from({ length: 8 }, (_, i) => {
      const lead = i < 3 ? leads[(i * 19) % leads.length] : null; // a few converted to leads
      return {
        tenantId,
        formId: enquiryForm.id,
        leadId: lead?.id ?? null,
        payload: {
          full_name: lead?.fullName ?? `${pick(CONTACT_FIRST)} ${pick(CONTACT_LAST)}`,
          phone: lead?.phone ?? mobile(),
          email: lead?.email ?? `enquiry${i}@example.com`,
          message: pick([
            'Looking for a two-bedroom in the Marina with a payment plan.',
            'Interested in off-plan investment options under 2M.',
            'Please send the Creek Gate brochure.',
            'Want to book a viewing this weekend.',
          ]),
          budget_range: budgetChoices[i % budgetChoices.length],
        },
        ipAddress: `94.204.${int(1, 254)}.${int(1, 254)}`,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15',
        referrerUrl: 'https://manathhomes.ae/marina-vista',
        utm: { source: 'google', medium: 'cpc', campaign: 'marina-vista-launch' },
        createdAt: businessDate(30),
      };
    }),
  });
  await db.form.create({
    data: {
      tenantId,
      key: 'site-visit-booking',
      name: 'Site Visit Booking',
      purpose: 'LEAD_CAPTURE',
      targetObject: 'LEAD',
      state: 'DRAFT',
      fields: {
        create: [
          { tenantId, key: 'full_name', label: 'Full name', type: 'TEXT' as const, position: 0, isRequired: true, mapsToField: 'fullName' },
          { tenantId, key: 'phone', label: 'Phone', type: 'PHONE' as const, position: 1, isRequired: true, mapsToField: 'phone' },
          { tenantId, key: 'email', label: 'Email', type: 'EMAIL' as const, position: 2, isRequired: false, mapsToField: 'email' },
          { tenantId, key: 'preferred_date', label: 'Preferred date', type: 'DATE' as const, position: 3, isRequired: true },
        ],
      },
    },
  });

  // 18. Landing pages ────────────────────────────────────────────────────────
  const marinaBlocks = [
    { type: 'hero', heading: 'Marina Vista Residences', subheading: 'Waterfront living from AED 1.2M — 60/40 payment plan' },
    { type: 'features', items: ['Handover Q4 2027', 'Projected 7–8% rental yield', 'Escrow-protected milestones'] },
    { type: 'form', formKey: 'property-enquiry' },
  ];
  const marinaPage = await db.landingPage.create({
    data: {
      tenantId,
      slug: 'marina-vista',
      name: 'Marina Vista Launch',
      state: 'PUBLISHED',
      seoTitle: 'Marina Vista Residences — Off-Plan Apartments in Dubai Marina',
      seoDescription: 'One to three bedroom waterfront apartments from AED 1.2M with a 60/40 payment plan.',
      blocks: marinaBlocks,
      formId: enquiryForm.id,
      publishedAt: new Date(now - 21 * 864e5),
      visitCount: int(900, 2400),
      submissionCount: 8,
    },
  });
  await db.landingPageVersion.create({
    data: { tenantId, landingPageId: marinaPage.id, versionNumber: 1, blocks: marinaBlocks },
  });
  await db.landingPage.create({
    data: {
      tenantId,
      slug: 'downtown-penthouse',
      name: 'Downtown Penthouse Collection',
      state: 'DRAFT',
      blocks: [{ type: 'hero', heading: 'Downtown Penthouse Collection', subheading: 'By invitation only' }],
    },
  });

  console.log(`\n  ${accounts.length} accounts · ${contacts.length} contacts · 1 pipeline (${PIPELINE_STAGES.length} stages) · ${lossReasons.length} loss reasons`);
  console.log(`  ${oppRows.length} opportunities (8 open · 4 won · 2 lost)`);
  console.log(`  1 scorecard (${CRITERIA.length} criteria) · ${callRows.length} calls · ${spoken.length} transcripts · 8 analyses · 6 audits`);
  console.log(`  ${followUpRows.length} follow-ups · ${targetCount} targets · ${notificationRows.length} notifications`);
  console.log(`  ${eventSpecs.length} events (${inviteeCount} invitees) · 3 campaigns · ${commRows.length} communications · 2 forms · 2 landing pages`);
}

// ── transcript generator ────────────────────────────────────────────────────
/** 20–28 turns of a believable off-plan sales call, labelled by speaker. */
function makeTranscript(
  ctx: CrmCtx,
  agent: string,
  customer: string,
  o: { project: string; area: string; beds: string; priceM: string; handover: string },
): string {
  const { pick, chance } = ctx;
  const t: string[] = [];
  const a = (s: string) => t.push(`Agent: ${s}`);
  const c = (s: string) => t.push(`Customer: ${s}`);

  a(`Good ${pick(['morning', 'afternoon'])}, this is ${agent} calling from Manath Homes. Am I speaking with ${customer}?`);
  c(`Yes, this is ${customer}. What is this regarding?`);
  a(`Thanks for taking the call. You enquired about apartments in ${o.area} ${pick(['earlier this week', 'a few days ago', 'last week'])} — is now a good time for two quick minutes?`);
  c(pick(['Sure, go ahead.', "I have a few minutes before a meeting, so let's keep it short.", "Yes, that's fine."]));
  a('Perfect. Just so you know, this call is recorded for quality purposes — is that alright?');
  c("That's fine.");
  a('Great. May I ask — would this be for your own use, or as an investment?');
  c(pick([
    'Mainly an investment. I want something that rents well.',
    `For my family — we are renting in ${pick(['Al Barsha', 'Mirdif', 'JVC'])} at the moment.`,
    'A bit of both, honestly. I would live in it first and rent it out later.',
  ]));
  a(`Understood. And do you have a budget range in mind for ${o.area}?`);
  c(`Somewhere around ${o.priceM} million, give or take.`);
  a(`That fits well. We have just released ${o.project} in ${o.area} — ${o.beds} units from AED ${o.priceM} million, a ${pick(['60/40', '70/30'])} payment plan, and handover in ${o.handover}.`);
  c(pick(['What floor plans are available?', 'Is that the price for a mid floor?', 'What are the service charges like?']));
  a(pick([
    'We have three layouts, all with balconies; I can send the floor plans right after this call.',
    'That is the starting price for the lower floors — the view premium is around five percent per band.',
    'Service charges are estimated at fourteen dirhams per square foot, which is competitive for the area.',
  ]));

  if (chance(0.5)) {
    c('To be honest, off-plan makes me a little nervous. What happens if the project is delayed?');
    a('A fair concern. Payments sit in an escrow account regulated by RERA and are released against construction milestones, so your money moves only as the building does.');
    c('Okay, that does help.');
  } else {
    c(`That is a bit above what I wanted to spend. I was hoping to stay under ${o.priceM} million.`);
    a(`Understood — with the ${pick(['60/40', '70/30'])} plan, only a portion is due before handover, which is why most buyers find the monthly outlay manageable. I can also show you a smaller layout that starts lower.`);
    c('Alright, I would want to see the numbers in writing.');
  }

  a(`Of course. And is rental yield a factor for you? ${o.area} has been projecting seven to eight percent on ${o.beds} units.`);
  c(pick(['Yield matters, yes — that is the whole point.', 'Less so than the view, but it matters.', 'I have read those numbers; are they realistic?']));
  a('I will include the latest rental comparables in the pack so you can judge the assumptions yourself.');

  if (chance(0.6)) {
    a(`Would you like to visit the sales centre? We have slots ${pick(['Saturday at 11:00', 'Sunday at 16:00', 'Thursday at 17:30'])} — the show apartment is worth seeing in person.`);
    c(pick(['Saturday could work. Send me the details.', 'Let me check with my wife and confirm tomorrow.', 'Yes, book it — I will move things around.']));
    a('Done. I will send the confirmation on WhatsApp with the location pin, plus the brochure and payment plan by email today.');
  } else {
    a('Shall I send you the brochure, floor plans and the full payment schedule by email, and give you a call back once you have had a look?');
    c(pick(['Yes, send everything and call me Thursday.', 'Email is best. Give me a few days with it.']));
    a(`Will do — everything goes out today, and I will follow up ${pick(['Thursday at 11:00', 'early next week'])}.`);
  }

  c(pick(['Thanks for the call.', 'Appreciate it — talk soon.', 'Thank you, goodbye.']));
  a(`Thank you, ${customer}. Speak soon.`);
  return t.join('\n');
}

// ── demo spotlight ───────────────────────────────────────────────────────────
/**
 * Populates the "my" views for every documented demo login: owned leads, a
 * live follow-up queue (overdue/today/upcoming), a mid-flight target, calls
 * made today and unread notifications. Runs on every seed — including top-up
 * runs where the CRM chain above was skipped — and is idempotent per user:
 * a demo identity that already owns leads is left alone. Each user gets a
 * distinct slice of leads so the accounts do not fight over the same records.
 */
export async function seedDemoSpotlight(db: PrismaClient, ctx: CrmCtx) {
  const { tenantId } = ctx;
  const demoUsers = ctx.users.filter((u) => u.email && /@manathhomes\.(com|ae)$/i.test(u.email));
  if (demoUsers.length === 0) return;

  const leads = await db.lead.findMany({
    where: { tenantId, deletedAt: null, ownerId: { not: null } },
    orderBy: { reference: 'asc' },
    select: { id: true, fullName: true, phone: true },
  });
  if (leads.length < 60) return;

  const now = Date.now();
  const todayAt = (hour: number) => {
    const d = new Date();
    d.setHours(hour, ctx.int(0, 55), 0, 0);
    return d;
  };
  const future = (minDays: number, maxDays: number, hour: number) => {
    const d = new Date(now + ctx.int(minDays, maxDays) * 864e5);
    d.setHours(hour, ctx.int(0, 55), 0, 0);
    return d;
  };
  const monthStart = (offset: number) => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() + offset, 1);
  };
  const monthEnd = (offset: number) => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() + offset + 1, 0, 23, 59, 59);
  };
  const dayKey = (base: Date, day: number) =>
    new Date(base.getFullYear(), base.getMonth(), day, 12).toISOString().slice(0, 10);

  let seeded = 0;
  for (let i = 0; i < demoUsers.length; i++) {
    const user = demoUsers[i]!;
    const alreadyOwns = await db.lead.count({ where: { tenantId, ownerId: user.id } });
    if (alreadyOwns > 0) continue;

    const slice = leads.slice(45 + i * 12, 57 + i * 12);
    if (slice.length < 6) continue;
    await db.lead.updateMany({
      where: { tenantId, id: { in: slice.map((l) => l.id) } },
      data: { ownerId: user.id },
    });

    const followUps: ['OPEN' | 'COMPLETED', Date][] = [
      ['OPEN', new Date(now - 3 * 864e5)],
      ['OPEN', new Date(now - 864e5)],
      ['OPEN', todayAt(16)],
      ['OPEN', todayAt(19)],
      ['OPEN', future(2, 5, 11)],
      ['COMPLETED', new Date(now - 5 * 864e5)],
    ];
    await db.followUpTask.createMany({
      data: followUps.map(([status, dueAt], j) => ({
        tenantId,
        leadId: slice[j % slice.length]!.id,
        ownerId: user.id,
        title: FOLLOW_UP_TITLES[(j * 3) % FOLLOW_UP_TITLES.length]!,
        dueAt,
        priority: (['HIGH', 'MEDIUM', 'MEDIUM', 'URGENT', 'LOW', 'MEDIUM'] as const)[j]!,
        status,
        completedAt: status === 'COMPLETED' ? new Date(now - 4 * 864e5) : null,
        outcome: status === 'COMPLETED' ? 'Done' : null,
      })),
    });

    const target = await db.employeeTarget.create({
      data: {
        tenantId,
        userId: user.id,
        metric: 'CALLS_CONNECTED',
        period: 'MONTHLY',
        targetValue: 50,
        periodStart: monthStart(0),
        periodEnd: monthEnd(0),
      },
    });
    const dom = Math.max(1, new Date().getDate());
    const days = [...new Set([1, Math.ceil(dom / 2), dom])];
    const per = Math.floor(31 / days.length);
    await db.targetProgress.createMany({
      data: days.map((day, j) => ({
        tenantId,
        targetId: target.id,
        userId: user.id,
        dateKey: dayKey(monthStart(0), day),
        achieved: j === 0 ? 31 - per * (days.length - 1) : per,
      })),
    });

    await db.call.createMany({
      data: [0, 1, 2, 3].map((j) => {
        const lead = slice[j]!;
        const started = todayAt(9 + j * 2);
        const scheduled = j === 3;
        return {
          tenantId,
          leadId: lead.id,
          callerId: user.id,
          direction: 'OUTBOUND' as const,
          status: scheduled ? ('SCHEDULED' as const) : ('COMPLETED' as const),
          outcome: scheduled ? null : (['CONNECTED', 'INTERESTED', 'VOICEMAIL'] as const)[j]!,
          recipientNumber: lead.phone ?? `+9715000${i}010${j}`,
          startedAt: scheduled ? null : started,
          endedAt: scheduled ? null : new Date(started.getTime() + (180 + j * 120) * 1000),
          durationSecs: scheduled ? null : 180 + j * 120,
          createdAt: started,
        };
      }),
    });

    await db.notification.createMany({
      data: [
        { tenantId, userId: user.id, kind: 'LEAD_ASSIGNED', title: 'New lead assigned', body: `${slice[0]!.fullName} was assigned to you.`, objectType: 'leads', recordId: slice[0]!.id, priority: 'MEDIUM', readAt: null },
        { tenantId, userId: user.id, kind: 'TASK_OVERDUE', title: 'Follow-up overdue', body: `A follow-up for ${slice[1]!.fullName} is past due.`, objectType: 'tasks', recordId: null, priority: 'HIGH', readAt: null },
        { tenantId, userId: user.id, kind: 'SLA_BREACHED', title: 'SLA breached', body: `First contact for ${slice[2]!.fullName} breached its SLA.`, objectType: 'leads', recordId: slice[2]!.id, priority: 'URGENT', readAt: null },
        { tenantId, userId: user.id, kind: 'TARGET_PROGRESS', title: 'Target update', body: 'You are at 62% of your calls-connected target for this month.', objectType: null, recordId: null, priority: 'MEDIUM', readAt: new Date() },
      ],
    });
    seeded++;
  }

  // Persona touches: the account manager owns a book of accounts, and the SDR's
  // queue skews to leads still at the top of the funnel.
  const accountManager = demoUsers.find((u) => u.email?.startsWith('account.manager@'));
  if (accountManager) {
    const unowned = await db.account.findMany({
      where: { tenantId, ownerId: { not: accountManager.id } },
      orderBy: { name: 'asc' },
      take: 8,
      select: { id: true },
    });
    if (unowned.length > 0) {
      await db.account.updateMany({
        where: { tenantId, id: { in: unowned.map((a) => a.id) } },
        data: { ownerId: accountManager.id },
      });
      await db.contact.updateMany({
        where: { tenantId, accountId: { in: unowned.map((a) => a.id) } },
        data: { ownerId: accountManager.id },
      });
    }
  }
  const sdr = demoUsers.find((u) => u.email?.startsWith('sdr@'));
  if (sdr) {
    const early = await db.lead.findMany({
      where: { tenantId, deletedAt: null, ownerId: { not: sdr.id }, stage: { key: { in: ['new', 'attempted', 'contacted'] } } },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: { id: true },
    });
    if (early.length > 0) {
      await db.lead.updateMany({ where: { tenantId, id: { in: early.map((l) => l.id) } }, data: { ownerId: sdr.id } });
    }
  }

  if (seeded > 0) {
    console.log(`  demo spotlight: ${seeded} demo login(s) given owned leads, follow-ups, a target, calls and notifications`);
  }
}
