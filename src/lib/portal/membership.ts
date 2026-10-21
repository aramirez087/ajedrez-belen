/**
 * A member family has at least one approved athlete. A request still waiting, rejected or
 * withdrawn is not membership, even while the family's link to it is open (a rejected one
 * stays linked until the family dismisses it).
 */
export async function hasApprovedAthlete(db: D1Database, userId: string): Promise<boolean> {
  return Boolean(await db.prepare(
    "SELECT 1 AS ok FROM guardian_links l JOIN athletes a ON a.id=l.athlete_id WHERE l.user_id=? AND l.active=1 AND a.approval_status='approved' LIMIT 1",
  ).bind(userId).first());
}
