/**
 * Rule-based confidence. Produces an ordinal level (High / Medium / Low / Insufficient)
 * with the factors behind it. This is deliberately NOT a probability.
 */

const SOURCE_QUALITY = {
  adr: 3, pr_description: 3, doc_section: 2, pr_review_comment: 2, commit_message: 2,
  pr_comment: 1.5, issue_body: 1.5, issue_comment: 1,
};

export function assessConfidence({ evidence, decisions, establishesReason, question }) {
  if (!evidence.length) {
    return {
      level: 'insufficient',
      explanation: 'No evidence in the imported graph is connected to this question.',
      factors: [],
      disclaimer: 'Rule-based level derived from evidence properties; not a calibrated probability.',
    };
  }

  const top = decisions[0];
  const supporting = evidence.filter((e) => e.supportsDecision || e.hasRationale);

  // Directness: is the reason stated verbatim in a record directly attached to the decision?
  const direct = Boolean(top?.node.props.rationaleStated && top.support.length);
  const indirectRationale = !direct && evidence.some((e) => e.hasRationale && e.path.length <= 2);
  const directness = direct ? 'direct' : indirectRationale ? 'indirect' : 'none';

  // Corroboration: independent records (different source URLs / record types)
  const sources = new Set(supporting.map((e) => `${e.node.props.sourceType}:${(e.node.props.url || '').split('#')[0]}`));
  const corroboration = sources.size;

  // Relationship reliability: share of confirmed edges on the paths of cited evidence
  const edges = evidence.flatMap((e) => e.path);
  const confirmedShare = edges.length ? edges.filter((x) => x.origin === 'confirmed').length / edges.length : 1;

  // Evidence quality: best source type among supporting items
  const quality = Math.max(0, ...evidence.map((e) => SOURCE_QUALITY[e.node.props.kind] || 1));

  // Temporal consistency
  const status = top?.node.props.status || null;
  const temporal =
    !top ? 'not applicable'
      : status === 'disputed' ? 'conflicting later records'
        : status === 'superseded' ? 'superseded (history shown)'
          : status === 'active' ? 'consistent'
            : 'unverified';

  let points = 0;
  if (directness === 'direct') points += 3;
  else if (directness === 'indirect') points += 1.5;
  if (corroboration >= 2) points += 1.5;
  if (confirmedShare >= 0.7) points += 1;
  if (quality >= 3) points += 1;
  if (temporal === 'conflicting later records') points -= 2;
  if (temporal === 'unverified') points -= 0.5;

  let level = points >= 5.5 ? 'high' : points >= 3 ? 'medium' : 'low';
  const whyQuestion = /\bwhy\b|reason|rationale/i.test(question || '');
  if (whyQuestion && !establishesReason) level = 'insufficient';

  const factors = [
    { name: 'Directness', value: directness, note: directness === 'direct' ? 'The rationale is stated in a record attached to the decision.' : directness === 'indirect' ? 'Rationale language appears in a nearby record, not in the decision source itself.' : 'No record states a reason.' },
    { name: 'Corroboration', value: `${corroboration} independent source${corroboration === 1 ? '' : 's'}`, note: corroboration >= 2 ? 'More than one record supports the explanation.' : 'Only one record supports it.' },
    { name: 'Relationship reliability', value: `${Math.round(confirmedShare * 100)}% confirmed links`, note: 'Confirmed = GitHub structured data; inferred = parsed from text.' },
    { name: 'Evidence quality', value: quality >= 3 ? 'strong' : quality >= 2 ? 'moderate' : 'weak', note: 'ADRs and PR descriptions rank above comments.' },
    { name: 'Temporal consistency', value: temporal, note: status ? `Top decision status: ${status}.` : 'No decision was matched.' },
  ];

  const explanation =
    level === 'insufficient'
      ? 'The graph contains related records, but none of them states the reason. TraceWhy will not guess.'
      : `${cap(level)} because: ${factors.slice(0, 3).map((f) => `${f.name.toLowerCase()} is ${f.value}`).join('; ')}${temporal !== 'consistent' && top ? `; temporal check: ${temporal}` : ''}.`;

  return { level, points, factors, explanation, disclaimer: 'Rule-based level derived from evidence properties; not a calibrated probability.' };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
