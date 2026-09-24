/**
 * The industries a company can be in, and where a lead came from.
 *
 * ─── Why these are plain strings ────────────────────────────────────────────
 *
 * Both were Prisma enums — eight industries and five sources — and a list this
 * long cannot be. Sixty-seven values would mean a database migration every time
 * somebody wants to add one, for a taxonomy whose whole purpose is to grow as
 * the studio takes on work it has not done before. So the column is a string
 * and the list lives here, the same reasoning as `Organization.aiProvider`.
 *
 * What that costs is database-level integrity, and what pays for it is this
 * file: the API validates against these arrays, so an industry that is not on
 * the list is refused at the door rather than by Postgres.
 *
 * ─── Why they are stored as the words themselves ────────────────────────────
 *
 * Not SCREAMING_SNAKE with a separate label map. The old enum needed one
 * because `IT_AND_SAAS` title-cases to "It And Saas" and lower-cases D2C and
 * B2B into nonsense — a whole file existed to spell the eight of them out. With
 * sixty-seven that file would be the feature. Storing "Technology & SaaS"
 * removes the translation step and the chance of the two drifting apart.
 *
 * The cost is that renaming an industry is a data migration rather than a label
 * change. That is the right trade for a list that gets appended to far more
 * often than it gets reworded.
 */

/**
 * What a company does. Ordered as the studio thinks about its market rather
 * than alphabetically, so the ones it actually sells to are near the top.
 */
export const INDUSTRIES = [
  'Sports & Fitness',
  'Fashion & Apparel',
  'Food & Beverage',
  'Beauty & Personal Care',
  'Healthcare & Wellness',
  'Education & EdTech',
  'Real Estate & Infrastructure',
  'Automotive & Mobility',
  'Technology & SaaS',
  'Consumer Electronics',
  'FMCG',
  'Retail',
  'E-commerce & D2C',
  'Hospitality',
  'Travel & Tourism',
  'Media & Entertainment',
  'Gaming & Esports',
  'Financial Services & FinTech',
  'Banking & Insurance',
  'Jewellery & Luxury',
  'Home & Interiors',
  'Architecture & Design',
  'Construction & Building Materials',
  'Manufacturing & Industrial',
  'Logistics & Supply Chain',
  'Transportation',
  'Aviation',
  'Events & Experiential',
  'Entertainment Venues',
  'Shopping Malls & Commercial Spaces',
  'Restaurants & QSR',
  'Hotels & Resorts',
  'Healthcare Technology',
  'Pharmaceuticals',
  'Fitness & Wellness',
  'Sportswear & Activewear',
  'Consumer Goods',
  'Home Appliances',
  'Smart Home & IoT',
  'Telecom',
  'AI & Emerging Technology',
  'Professional Services',
  'Consulting',
  'Legal Services',
  'HR & Recruitment',
  'Corporate & B2B',
  'Startups',
  'Government & Public Sector',
  'NGOs & Social Impact',
  'Publishing & News Media',
  'Music & Culture',
  'Art & Lifestyle',
  'Kids & Parenting',
  'Pet Care',
  'Agriculture & AgriTech',
  'Sustainability & CleanTech',
  'Energy & Renewables',
  'EV & Automotive Technology',
  'Creator & Influencer Brands',
  'Personal Brands',
  'Franchise Businesses',
  'Luxury & Premium Lifestyle',
  'Property & PropTech',
  'Education Institutions',
  'Training & Skill Development',
  'Sports Academies & Clubs',
  'Event & Sports Leagues',
] as const;

export type Industry = (typeof INDUSTRIES)[number];

/** Where a lead came from. */
export const LEAD_SOURCES = [
  'Website / Inbound',
  'Social Media',
  'Paid Ads',
  'Cold Outreach',
  'LinkedIn',
  'Referrals',
  'Existing Clients',
  'Networking & Events',
  'Partnerships',
  'Email Marketing',
  'Google / SEO',
  'Justdial',
  'Founder / Personal Network',
  'Word of Mouth',
] as const;

export type LeadSource = (typeof LEAD_SOURCES)[number];

export const isIndustry = (v: unknown): v is Industry =>
  typeof v === 'string' && (INDUSTRIES as readonly string[]).includes(v);

export const isLeadSource = (v: unknown): v is LeadSource =>
  typeof v === 'string' && (LEAD_SOURCES as readonly string[]).includes(v);

/**
 * What the eight old industries and five old sources become.
 *
 * Every existing row carries one of these, so the migration reads from here and
 * so does anything still handing over an old value — the CSV importer's header
 * aliases, an old bookmark with `?vertical=SPORTS` in it.
 *
 * `PARTNER_AGENCY` is the one that needed a decision rather than a lookup: the
 * new list has no "partner agency", and the work those rows describe is
 * referred through Vyoma, so it becomes Partnerships. `NETWORK` becomes
 * Networking & Events rather than Founder / Personal Network, because the old
 * value covered both and events is the broader of the two.
 */
export const LEGACY_INDUSTRY: Record<string, Industry> = {
  HEALTHCARE: 'Healthcare & Wellness',
  REAL_ESTATE: 'Real Estate & Infrastructure',
  D2C: 'E-commerce & D2C',
  SPORTS: 'Sports & Fitness',
  IT_AND_SAAS: 'Technology & SaaS',
  RETAIL: 'Retail',
  B2B: 'Corporate & B2B',
  HOSPITALITY: 'Hospitality',
};

export const LEGACY_SOURCE: Record<string, LeadSource> = {
  OUTREACH: 'Cold Outreach',
  REFERRAL: 'Referrals',
  INBOUND: 'Website / Inbound',
  PARTNER_AGENCY: 'Partnerships',
  NETWORK: 'Networking & Events',
};

/** What a row gets when nothing else fits. */
export const DEFAULT_INDUSTRY: Industry = 'Corporate & B2B';
export const DEFAULT_LEAD_SOURCE: LeadSource = 'Cold Outreach';
