import { supersessionCue } from '../parse/references.js';

/**
 * Temporal reasoning over decisions.
 *
 * Principle: a newer record NEVER supersedes an older decision just because it is newer.
 * A SUPERSEDES link requires explicit evidence:
 *   - git_revert:        "This reverts commit <sha>" / 'Revert "<title>"' pointing at the older source
 *   - adr_status:        ADR "Supersedes ADR-3" / "Superseded by ADR-7"
 *   - explicit_reference: change language (replace/revert/no longer/...) AND an explicit
 *                         reference (#PR, #issue, commit sha) to the older decision's source
 * Two decisions that touch the same specific code entity with change language but
 * without an explicit link are recorded as a *possible conflict* (status "disputed"),
 * never as supersession.
 *
 * Input decision shape (see buildGraph.js):
 *   { id, date, statement, fullText, refs, source: {kind, sha?, number?, path?, title?, shas?[]},
 *     affects: [{id, label}], adrNumber?, adrSupersedes?[], adrSupersededBy?[], declaredStatus?,
 *     merged?: boolean|null, affectsAtHead: number }
 */
export function detectSupersession(decisions) {
  const links = []; // {from: newerId, to: olderId, type, method, reason, evidenceText, date}
  const byAdr = new Map(decisions.filter((d) => d.adrNumber != null).map((d) => [d.adrNumber, d]));
  const sorted = [...decisions].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const pointsAt = (newer, older) => {
    const r = newer.refs || {};
    const src = older.source || {};
    const olderShas = [src.sha, ...(src.shas || [])].filter(Boolean);
    const shaHit = (sha) => sha && olderShas.some((s) => s.startsWith(sha) || sha.startsWith(s.slice(0, 7)));
    if (r.revertsSha && shaHit(r.revertsSha)) return { method: 'git_revert', detail: `reverts commit ${r.revertsSha.slice(0, 7)}` };
    if (r.revertTitle && src.title && r.revertTitle.trim() === src.title.trim()) return { method: 'git_revert', detail: `reverts "${src.title}"` };
    const cue = supersessionCue(newer.fullText);
    if (!cue) return null;
    if (src.number != null && (r.numbers || []).includes(src.number)) return { method: 'explicit_reference', detail: `"${cue}" + reference to #${src.number}` };
    const shaRef = (r.shas || []).find((s) => s.length >= 7 && shaHit(s));
    if (shaRef) return { method: 'explicit_reference', detail: `"${cue}" + reference to commit ${shaRef.slice(0, 7)}` };
    return null;
  };

  // 1) ADR status links (date independent; the ADR states it)
  for (const d of decisions) {
    for (const n of d.adrSupersedes || []) {
      const older = byAdr.get(n);
      if (older && older.id !== d.id && !links.some((l) => l.from === d.id && l.to === older.id)) links.push(link(d, older, 'SUPERSEDES', 'adr_status', `ADR ${d.adrNumber} states it supersedes ADR ${n}`));
    }
    for (const n of d.adrSupersededBy || []) {
      const newer = byAdr.get(n);
      if (newer && newer.id !== d.id && !links.some((l) => l.from === newer.id && l.to === d.id)) {
        links.push(link(newer, d, 'SUPERSEDES', 'adr_status', `ADR ${d.adrNumber} states it is superseded by ADR ${n}`));
      }
    }
  }

  // 2) Revert / explicit reference links, newer -> older only
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const older = sorted[i];
      const newer = sorted[j];
      if (!older.date || !newer.date || newer.date <= older.date) continue;
      if (sameSource(newer, older)) continue; // e.g. a squash commit and its own PR
      const hit = pointsAt(newer, older);
      if (hit && !links.some((l) => l.from === newer.id && l.to === older.id)) {
        links.push(link(newer, older, 'SUPERSEDES', hit.method, hit.detail));
        continue;
      }
      // 3) Possible conflict: same specific entity + change language, no explicit link
      const shared = sharedSpecificEntities(older, newer);
      if (shared.length && supersessionCue(newer.statement)) {
        links.push(link(newer, older, 'POSSIBLE_CONFLICT', 'shared_entity_with_change_language',
          `both affect ${shared.slice(0, 3).join(', ')}; the later one uses change language but does not reference the earlier one`));
      }
    }
  }

  return { links, statuses: resolveStatuses(decisions, links) };
}

function link(newer, older, type, method, reason) {
  return { from: newer.id, to: older.id, type, method, reason, date: newer.date || null, evidenceText: newer.statement };
}

function sameSource(a, b) {
  const sa = a.source || {};
  const sb = b.source || {};
  const shasA = [sa.sha, ...(sa.shas || [])].filter(Boolean);
  const shasB = new Set([sb.sha, ...(sb.shas || [])].filter(Boolean));
  return (
    shasA.some((s) => shasB.has(s)) ||
    (sa.number != null && sa.number === sb.number) ||
    Boolean(sa.path && sa.path === sb.path)
  );
}

function sharedSpecificEntities(a, b) {
  const specific = (d) => new Map((d.affects || []).filter((e) => e.label === 'Configuration' || e.label === 'Function').map((e) => [e.id, e.name || e.id]));
  const ma = specific(a);
  const mb = specific(b);
  return [...ma.keys()].filter((k) => mb.has(k)).map((k) => ma.get(k));
}

/** Status per decision: active | superseded | disputed | unknown, each with a reason. */
export function resolveStatuses(decisions, links) {
  const byId = new Map(decisions.map((d) => [d.id, d]));
  const incoming = (id, type) => links.filter((l) => l.to === id && l.type === type);
  const statuses = {};

  // Is decision X itself undone by a revert? (then it no longer supersedes anything)
  const isReverted = (id) => incoming(id, 'SUPERSEDES').some((l) => l.method === 'git_revert');

  for (const d of decisions) {
    const sup = incoming(d.id, 'SUPERSEDES');
    const effective = sup.filter((l) => !isReverted(l.from));
    const conflicts = incoming(d.id, 'POSSIBLE_CONFLICT');

    if (effective.length) {
      const l = effective[0];
      statuses[d.id] = { status: 'superseded', reason: `Superseded by a later decision (${l.method.replace(/_/g, ' ')}: ${l.reason}).`, by: effective.map((x) => x.from) };
    } else if (sup.length) {
      statuses[d.id] = { status: 'active', reason: 'A later change replaced it, but that change was itself reverted.', by: [] };
    } else if (d.declaredStatus === 'superseded') {
      statuses[d.id] = { status: 'superseded', reason: 'The ADR itself declares this decision superseded/deprecated; the replacing record was not found in the import.', by: [] };
    } else if (conflicts.length) {
      const c = byId.get(conflicts[0].from);
      statuses[d.id] = { status: 'disputed', reason: `A later decision (${c?.date?.slice(0, 10) || 'unknown date'}) changes the same code without explicitly referencing this one. Review both.`, by: conflicts.map((x) => x.from) };
    } else if (d.declaredStatus === 'accepted') {
      statuses[d.id] = { status: 'active', reason: 'The ADR declares it accepted and no later record supersedes it.', by: [] };
    } else if (d.merged === false) {
      statuses[d.id] = { status: 'unknown', reason: 'Proposed in a pull request that was not merged.', by: [] };
    } else if (!d.affects?.length) {
      statuses[d.id] = { status: 'unknown', reason: 'No affected code could be linked, so it is not possible to check whether it still applies.', by: [] };
    } else if (d.affectsAtHead === 0) {
      statuses[d.id] = { status: 'unknown', reason: 'The code it affected no longer exists at the latest commit.', by: [] };
    } else {
      statuses[d.id] = { status: 'active', reason: 'No later record in the imported history reverses or replaces it, and the affected code still exists.', by: [] };
    }
  }
  return statuses;
}
