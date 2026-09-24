#!/usr/bin/env node
/**
 * Hide a logo by title or slug - changes status from AVAILABLE to HIDDEN
 * Usage: npx tsx scripts/hide-logo.ts "coin bloom"
 * Or: npx tsx scripts/hide-logo.ts --slug coin-bloom
 */

import { revalidateTag } from 'next/cache'
import { CATALOG_TAG } from '../src/lib/catalog'
import { prisma } from '../src/lib/prisma'
import { invalidateCache, CACHE_KEYS } from '../src/lib/redis'

async function hideLogo(search: string, bySlug = false) {
  try {
    const searchField = bySlug ? 'slug' : 'title'
    const searchValue = bySlug ? search : search.toLowerCase()

    // Find the logo
    const logo = await prisma.logo.findFirst({
      where: bySlug
        ? { slug: searchValue }
        : {
            title: {
              contains: search,
              mode: 'insensitive',
            },
          },
      select: {
        id: true,
        slug: true,
        title: true,
        status: true,
      },
    })

    if (!logo) {
      console.error(`❌ Logo not found with ${searchField}: "${search}"`)
      console.log('\nSearching all logos...')

      // Show available logos to help user
      const allLogos = await prisma.logo.findMany({
        where: { status: 'AVAILABLE' },
        select: { id: true, slug: true, title: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      })

      if (allLogos.length > 0) {
        console.log('\nCurrently available logos:')
        allLogos.forEach((l, i) => {
          console.log(`  ${i + 1}. "${l.title}" (slug: ${l.slug})`)
        })
      }

      process.exit(1)
    }

    console.log(`\nFound logo:`)
    console.log(`  Title: ${logo.title}`)
    console.log(`  Slug: ${logo.slug}`)
    console.log(`  Current status: ${logo.status}`)

    if (logo.status === 'HIDDEN') {
      console.log('\n✓ Logo is already hidden')
      process.exit(0)
    }

    if (logo.status === 'SOLD') {
      console.error('\n❌ Cannot hide sold logos')
      process.exit(1)
    }

    // Update status to HIDDEN
    const updated = await prisma.logo.update({
      where: { id: logo.id },
      data: { status: 'HIDDEN' },
      select: {
        id: true,
        slug: true,
        title: true,
        status: true,
        updatedAt: true,
      },
    })

    console.log(`\n✓ Logo hidden successfully`)
    console.log(`  New status: ${updated.status}`)
    console.log(`  Updated at: ${updated.updatedAt.toISOString()}`)

    // Clear caches
    console.log('\nClearing caches...')
    await Promise.all([
      invalidateCache(CACHE_KEYS.ALL_LOGOS),
      invalidateCache(CACHE_KEYS.LOGO_BY_ID(logo.id)),
    ])

    console.log('✓ Cache cleared')
    console.log('\n✓ Done! The logo is now hidden from the public catalog.')
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : 'Unknown error')
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Parse command line arguments
const args = process.argv.slice(2)
const slugIndex = args.indexOf('--slug')
const bySlug = slugIndex !== -1

if (args.length === 0) {
  console.error('Usage: npx tsx scripts/hide-logo.ts "coin bloom"')
  console.error('   or: npx tsx scripts/hide-logo.ts --slug coin-bloom')
  process.exit(1)
}

const search = bySlug ? args[slugIndex + 1] : args[0]

if (!search) {
  console.error('Error: Please provide a title or slug to search for')
  process.exit(1)
}

console.log(`Searching for logo by ${bySlug ? 'slug' : 'title'}: "${search}"...\n`)

hideLogo(search, bySlug).catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
