import type { LogoStatus, Prisma } from '@prisma/client'
import { unstable_cache } from 'next/cache'
import { prisma } from './prisma'

/**
 * Cache tag for anything derived from the public catalog. Admin mutations
 * call revalidateTag(CATALOG_TAG) so a listing change is reflected without
 * waiting for the time-based window to lapse.
 */
export const CATALOG_TAG = 'catalog'

/** One hour. The catalog changes a few times a week, not a few times a minute. */
const CATALOG_REVALIDATE_SECONDS = 3600

/**
 * Temporary exclusion list for logos that should not appear in the public catalog.
 * Add slugs or IDs here to hide specific logos without changing their database status.
 * This is useful for case studies or work-in-progress that shouldn't be public yet.
 */
const EXCLUDED_LOGOS = new Set([
  'coin-bloom',
  // Add more slugs or IDs here as needed
])

export type CatalogLogo = {
  id: string
  slug: string
  title: string
  thumbnail: string
  tags: string[]
}

export type LogoDetail = CatalogLogo & {
  description: string
  images: string[]
  status: string
  price: {
    summon: number
    revival: number
    afterlife: string
  } | null
  gallery: { id: string; imageUrl: string }[]
  designer: {
    id: string
    name: string
    email: string
    twitter: string | null
    website: string | null
    logos: CatalogLogo[]
  } | null
}

const PUBLISHED_STATUSES: LogoStatus[] = ['AVAILABLE', 'SOLD']

const designerDetailSelect = {
  id: true,
  name: true,
  email: true,
  twitter: true,
  website: true,
  logos: {
    where: { status: { in: PUBLISHED_STATUSES } },
    select: { id: true, slug: true, title: true, thumbnail: true, tags: true },
    orderBy: { createdAt: 'desc' as const },
    take: 6,
  },
} satisfies Prisma.DesignerSelect

const logoDetailSelect = {
  id: true,
  slug: true,
  title: true,
  thumbnail: true,
  tags: true,
  description: true,
  status: true,
  price: { select: { summon: true, revival: true, afterlife: true } },
  gallery: { select: { id: true, imageUrl: true }, orderBy: { id: 'asc' as const } },
  designer: { select: designerDetailSelect },
} satisfies Prisma.LogoSelect

function toLogoDetail(
  logo: Prisma.LogoGetPayload<{ select: typeof logoDetailSelect }>,
): LogoDetail {
  return {
    ...logo,
    images: [logo.thumbnail, ...logo.gallery.map((item) => item.imageUrl)].filter(Boolean),
  }
}

/**
 * Logos shown on the catalog.
 *
 * Status is filtered in the query. The previous implementation returned every
 * logo with its full gallery and let the browser discard the ones it should
 * not see, which shipped unreleased and already-sold work to every visitor.
 * Only the four fields the card renders are selected.
 *
 * Logos in the EXCLUDED_LOGOS set are filtered out client-side after the query.
 */
export const getAvailableLogos = unstable_cache(
  async (): Promise<CatalogLogo[]> => {
    const logos = await prisma.logo.findMany({
      where: { status: 'AVAILABLE' },
      select: { id: true, slug: true, title: true, thumbnail: true, tags: true },
      orderBy: { createdAt: 'desc' },
    })
    // Filter out excluded logos
    return logos.filter((logo) => !EXCLUDED_LOGOS.has(logo.slug) && !EXCLUDED_LOGOS.has(logo.id))
  },
  ['catalog-available-logos', 'slug-v1', 'excluded-v1'],
  { tags: [CATALOG_TAG], revalidate: CATALOG_REVALIDATE_SECONDS },
)

/** Every slug that should get a prerendered product page. */
export const getPublishedLogoSlugs = unstable_cache(
  async (): Promise<string[]> => {
    const logos = await prisma.logo.findMany({
      where: { status: { in: PUBLISHED_STATUSES } },
      select: { slug: true },
    })
    // Filter out excluded logos
    return logos.map((logo) => logo.slug).filter((slug) => !EXCLUDED_LOGOS.has(slug))
  },
  ['catalog-published-slugs', 'slug-v1', 'excluded-v1'],
  { tags: [CATALOG_TAG], revalidate: CATALOG_REVALIDATE_SECONDS },
)

/** @deprecated Prefer getPublishedLogoSlugs */
export const getPublishedLogoIds = getPublishedLogoSlugs

/**
 * A single logo's public detail. Returns null for hidden, draft, and
 * in-review listings so unreleased work is not reachable by guessing an id.
 * Looks up by pretty slug first, then by id so old links still resolve.
 *
 * Excluded logos are treated as if they don't exist.
 */
export const getLogoDetail = unstable_cache(
  async (slugOrId: string): Promise<LogoDetail | null> => {
    // Check exclusion list first
    if (EXCLUDED_LOGOS.has(slugOrId)) {
      return null
    }

    const logo =
      (await prisma.logo.findFirst({
        where: { slug: slugOrId, status: { in: PUBLISHED_STATUSES } },
        select: logoDetailSelect,
      })) ??
      (await prisma.logo.findFirst({
        where: { id: slugOrId, status: { in: PUBLISHED_STATUSES } },
        select: logoDetailSelect,
      }))

    if (!logo) return null

    // Double-check exclusion by both slug and id
    if (EXCLUDED_LOGOS.has(logo.slug) || EXCLUDED_LOGOS.has(logo.id)) {
      return null
    }

    return toLogoDetail(logo)
  },
  ['catalog-logo-detail', 'prices-v3', 'designer-v3', 'slug-v1', 'excluded-v1'],
  { tags: [CATALOG_TAG], revalidate: CATALOG_REVALIDATE_SECONDS },
)

/**
 * Admin preview of any logo id, including draft / rejected / review / trash.
 * Uncached — status can change from the admin table at any moment.
 */
export async function getLogoDetailForAdmin(id: string): Promise<LogoDetail | null> {
  const logo = await prisma.logo.findUnique({
    where: { id },
    select: logoDetailSelect,
  })
  return logo ? toLogoDetail(logo) : null
}
