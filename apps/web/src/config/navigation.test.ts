/**
 * One navigation, and the one question that decides what is on it.
 *
 * This is worth testing because the failure is silent in both directions: an
 * item that should be hidden renders a door onto a 403, and an item that
 * should be visible simply is not there — and nobody reports a menu entry they
 * have never seen. Both happened. The sidebar used to score people on a rank
 * ladder while the server enforced permission switches, so a department head
 * carried four links that only ever produced a permission error.
 *
 * The rule these tests hold: a link is in the navigation if and only if the
 * screen behind it will open.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ROLE_PRESET_PERMISSIONS, type RolePreset } from '@flowzen/shared';
import { NAV_SECTIONS, NAV_ITEMS, BOTTOM_NAV_ITEMS, canSee, visibleSections, permissionForPath } from './navigation';

const HERE = dirname(fileURLToPath(import.meta.url));

/** A person, described the way every auth response describes them. */
const as = (preset: RolePreset) => ({ permissions: ROLE_PRESET_PERMISSIONS[preset] });

const labels = (sections: { items: { label: string }[] }[]) =>
  sections.flatMap((s) => s.items.map((i) => i.label));

const seenBy = (preset: RolePreset) => labels(visibleSections(as(preset)));

describe('the four sections', () => {
  it('is Daily, Business, Management and Admin — in that order', () => {
    expect(NAV_SECTIONS.map((s) => s.title)).toEqual(['DAILY', 'BUSINESS', 'MANAGEMENT', 'ADMIN']);
  });

  it('has no route twice — two lit items is a navigation arguing with itself', () => {
    const hrefs = [...NAV_ITEMS, ...BOTTOM_NAV_ITEMS].map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('offers nothing that no longer exists', () => {
    // /modules was the switcher, /crm the second morning screen, /revenue the
    // money page before it was renamed, /build-spec a removed feature. A link
    // to any of them is a door onto a redirect.
    const hrefs = [...NAV_ITEMS, ...BOTTOM_NAV_ITEMS].map((i) => i.href);
    for (const gone of ['/modules', '/crm', '/revenue', '/build-spec']) {
      expect(hrefs).not.toContain(gone);
    }
  });
});

describe('permission — the only question', () => {
  it('admits exactly who holds the switch an item names', () => {
    const board = { needs: 'pipeline.read' as const };
    expect(canSee(board, ['work.own'])).toBe(false);
    expect(canSee(board, ['pipeline.read'])).toBe(true);
  });

  it('is not a ladder — a head does not inherit what business development has', () => {
    // The exact bug this replaced. HEAD outranked BD on the old scale, so the
    // sidebar handed a department head the pipeline; the server refused it.
    const board = { needs: 'pipeline.read' as const };
    expect(canSee(board, ROLE_PRESET_PERMISSIONS.BD)).toBe(true);
    expect(canSee(board, ROLE_PRESET_PERMISSIONS.HEAD)).toBe(false);
  });

  it('honours setup.admin as the master switch, exactly as the server does', () => {
    expect(canSee({ needs: 'pipeline.read' }, ['setup.admin'])).toBe(true);
  });

  it('shows an unmarked item to everybody, and nothing to a person with no switches', () => {
    expect(canSee({}, ['work.own'])).toBe(true);
    expect(canSee({ needs: 'work.own' }, [])).toBe(false);
    expect(canSee({ needs: 'work.own' }, undefined)).toBe(false);
  });

  it('gives an unauthenticated caller nothing at all', () => {
    expect(visibleSections(null)).toEqual([]);
    expect(visibleSections({})).toEqual([]);
  });

  it('drops a section rather than leaving a heading over a gap', () => {
    const sections = visibleSections(as('EMPLOYEE'));
    expect(sections.every((s) => s.items.length > 0)).toBe(true);
  });
});

describe('what each preset actually gets', () => {
  it('gives an Employee their own work and the equipment catalogue, and nothing else', () => {
    // Assets is deliberately ungated. A designer needs to know whether the
    // 24-70 is free on Friday, and a register only half the office can read is
    // one the other half keeps in a WhatsApp thread instead. What they cannot
    // do inside it — hand anything over, see what it cost — the server refuses.
    //
    expect(seenBy('EMPLOYEE')).toEqual(['My Work', 'Assets']);
  });

  it('shows an Employee both rows without a heading over either', () => {
    // Assets lives under MANAGEMENT, and an Employee has none of the other
    // three items there — so the section used to reduce to a MANAGEMENT
    // heading carrying one row about who is holding a lens. A heading over a
    // single link groups nothing and, here, described it wrongly.
    const sections = visibleSections(as('EMPLOYEE'));
    expect(sections.map((s) => s.title)).toEqual([null, null]);
    expect(sections.map((s) => s.items.length)).toEqual([1, 1]);
  });

  it('keeps the headings for everybody with more than one row under them', () => {
    // The rule is about grouping, not about hiding words: the moment a second
    // item appears under a heading it is doing its job and stays.
    const titled = visibleSections(as('MANAGEMENT')).filter((s) => s.items.length > 1);
    expect(titled.length).toBeGreaterThan(0);
    expect(titled.every((s) => s.title !== null)).toBe(true);
  });

  it('gives Business Development the clients and the board, but not the work or the money', () => {
    const seen = seenBy('BD');
    expect(seen).toEqual(
      expect.arrayContaining(['My Work', 'Companies', 'Outreach list', 'Pipeline', 'Proposals']),
    );
    expect(seen).not.toContain('Live work');
    expect(seen).not.toContain('Money');
    expect(seen).not.toContain('Team');
  });

  it('gives a Head the work and their team, but not the pipeline', () => {
    const seen = seenBy('HEAD');
    expect(seen).toEqual(expect.arrayContaining(['My Work', 'Team', 'Live work', 'Time split']));
    expect(seen).not.toContain('Pipeline');
    expect(seen).not.toContain('Proposals');
    expect(seen).not.toContain('Companies');
  });

  it('gives Accounts the money, but not the team or the pipeline', () => {
    const seen = seenBy('ACCOUNTS');
    expect(seen).toEqual(expect.arrayContaining(['My Work', 'Companies', 'Money', 'Time split']));
    expect(seen).not.toContain('Team');
    expect(seen).not.toContain('Pipeline');
    // The management reports are `reports.read`, which Accounts does not hold.
    expect(seen).not.toContain('Monday brief');
    expect(seen).not.toContain('Forecast');
  });

  it('gives Management every screen there is', () => {
    expect(seenBy('MANAGEMENT').sort()).toEqual(NAV_ITEMS.map((i) => i.label).sort());
  });
});

describe('the mobile tab bar', () => {
  const primaries = NAV_ITEMS.filter((i) => i.isPrimaryMobile);

  it('marks more primaries than fit, so every role fills its four', () => {
    expect(primaries.length).toBeGreaterThan(4);
  });

  it('gives every preset at least one real tab, and never a locked one', () => {
    for (const preset of ['EMPLOYEE', 'BD', 'HEAD', 'ACCOUNTS', 'MANAGEMENT'] as RolePreset[]) {
      const mine = primaries.filter((i) => canSee(i, ROLE_PRESET_PERMISSIONS[preset]));
      expect(mine.length).toBeGreaterThan(0);
      for (const item of mine) {
        expect(canSee(item, ROLE_PRESET_PERMISSIONS[preset])).toBe(true);
      }
    }
  });
});

describe('every item names a permission the API actually enforces', () => {
  it('uses only real permission keys', () => {
    // A typo here fails open or closed silently, so the set is checked against
    // the shared contract rather than trusted.
    const real = new Set(Object.values(ROLE_PRESET_PERMISSIONS).flat());
    for (const item of NAV_ITEMS) {
      if (item.needs) expect(real.has(item.needs)).toBe(true);
    }
  });

  it('leaves three screens open to everybody, and gates the rest', () => {
    // Deliberately a short list, and each one is a decision:
    //   /my-work   everybody has their own work
    //   /profile   everybody has an account
    //   /assets    everybody needs to know where the kit is (the ACTIONS
    //              inside it are gated on asset.manage by the server)
    // A fourth arriving here without a reason written beside it is the thing
    // this assertion exists to stop.
    const open = [...NAV_ITEMS, ...BOTTOM_NAV_ITEMS].filter((i) => !i.needs).map((i) => i.href);
    expect(open.sort()).toEqual(['/assets', '/my-work', '/profile']);
  });
});

describe('every screen in the app is behind the guard, not just the listed ones', () => {
  /*
   * The layout asks `permissionForPath`, which used to read NAV_ITEMS alone —
   * so any screen reached by clicking through rather than from the sidebar
   * answered `undefined`, and `undefined` means open. `/projects/[id]` and
   * `/retainers/[id]` were both in that gap: a kept URL mounted a client's
   * record for anybody, and the page then assembled itself out of the server's
   * refusals instead of redirecting.
   *
   * This reads the routes off the filesystem rather than a list somebody has
   * to remember to update, so the next screen added lands here on its own.
   */
  const DASHBOARD = join(HERE, '..', 'app', '(dashboard)');

  /** Deliberately open, each for a reason — same three the sidebar allows. */
  const OPEN = new Set(['/my-work', '/profile', '/assets']);

  it('gates every route under (dashboard) that is not deliberately open', () => {
    const routes = readdirSync(DASHBOARD, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => `/${e.name}`);

    // A sanity check on the reading itself: if this ever finds nothing, the
    // assertions below would pass by being vacuous.
    expect(routes.length).toBeGreaterThan(10);

    const ungated = routes.filter((r) => !OPEN.has(r) && permissionForPath(r) === undefined);
    expect(ungated, `these screens are open to anybody who types the URL: ${ungated.join(', ')}`).toEqual([]);
  });

  it('gates the record pages underneath them too', () => {
    // The guard prefix-matches, so a child route inherits its parent's answer.
    expect(permissionForPath('/projects/abc123')).toBe('work.all');
    expect(permissionForPath('/retainers/abc123')).toBe('work.all');
    expect(permissionForPath('/companies/abc123')).toBe('company.read');
  });
});
