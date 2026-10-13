import type { Env } from '../types.ts';

export interface ExpiryJobResult {
  checked: number;
  extended: number;
  deleted: number;
  deletedPostIds: string[];
  extendedPostIds: string[];
}

/**
 * Runs the daily post lifecycle expiry check.
 *
 * Rules:
 * - Posts initial expiry = created_at + 7 days.
 * - At day 7: if at least 3 distinct users other than the author liked or commented,
 *   extend expires_at to day 14 (created_at + 14 days).
 * - Otherwise expire immediately.
 * - Hard stop at day 14 (created_at + 14 days): unconditionally expire.
 * - Expiry deletes post, comments, reactions, post_media rows, media records, and R2 objects together.
 */
export async function runPostLifecycleExpiry(
  env: Env,
  referenceTime = Date.now()
): Promise<ExpiryJobResult> {
  const referenceIso = new Date(referenceTime).toISOString();

  // Find all active posts that have reached or passed their current expires_at
  const candidates = await env.DB.prepare(
    `SELECT id, author_id, created_at, expires_at
     FROM posts
     WHERE status = 'active' AND expires_at <= ?`
  )
    .bind(referenceIso)
    .all<{
      id: string;
      author_id: string;
      created_at: string;
      expires_at: string;
    }>();

  const posts = candidates.results || [];
  let extendedCount = 0;
  let deletedCount = 0;
  const deletedPostIds: string[] = [];
  const extendedPostIds: string[] = [];

  for (const post of posts) {
    const createdAtMs = new Date(post.created_at).getTime();
    const currentExpiresMs = new Date(post.expires_at).getTime();
    const day14Ms = createdAtMs + 14 * 24 * 60 * 60 * 1000;

    // Hard stop at day 14:
    // If the post has reached or exceeded day 14, or was already extended to day 14
    const isAtOrPastDay14 =
      referenceTime >= day14Ms || currentExpiresMs >= day14Ms - 1000;

    if (isAtOrPastDay14) {
      // Hard stop: delete immediately
      await deletePostAndMedia(env, post.id);
      deletedCount++;
      deletedPostIds.push(post.id);
      continue;
    }

    // Day 7 check: check distinct users other than author who liked or commented
    const engagersResult = await env.DB.prepare(
      `SELECT COUNT(DISTINCT user_id) as engagers_count
       FROM (
         SELECT user_id FROM post_reactions WHERE post_id = ? AND user_id != ?
         UNION
         SELECT author_id AS user_id FROM comments WHERE post_id = ? AND author_id != ?
       )`
    )
      .bind(post.id, post.author_id, post.id, post.author_id)
      .first<{ engagers_count: number }>();

    const distinctEngagers = Number(engagersResult?.engagers_count || 0);

    if (distinctEngagers >= 3) {
      // Extend to day 14
      const extendedExpiresAt = new Date(day14Ms).toISOString();
      await env.DB.prepare(
        'UPDATE posts SET expires_at = ? WHERE id = ?'
      )
        .bind(extendedExpiresAt, post.id)
        .run();

      extendedCount++;
      extendedPostIds.push(post.id);
    } else {
      // Less than 3 distinct engagers: expire post
      await deletePostAndMedia(env, post.id);
      deletedCount++;
      deletedPostIds.push(post.id);
    }
  }

  return {
    checked: posts.length,
    extended: extendedCount,
    deleted: deletedCount,
    deletedPostIds,
    extendedPostIds,
  };
}

/**
 * Deletes post, linked media records, and corresponding R2 objects in D1 batch.
 */
export async function deletePostAndMedia(env: Env, postId: string): Promise<void> {
  // 1. Fetch linked media records
  const linkedMedia = await env.DB.prepare(
    `SELECT m.id, m.object_key
     FROM media m
     JOIN post_media pm ON pm.media_id = m.id
     WHERE pm.post_id = ?`
  )
    .bind(postId)
    .all<{ id: string; object_key: string }>();

  const mediaList = linkedMedia.results || [];

  // 2. Delete objects from R2 storage
  if (env.MEDIA_BUCKET && mediaList.length > 0) {
    for (const m of mediaList) {
      try {
        await env.MEDIA_BUCKET.delete(m.object_key);
      } catch (err) {
        console.error(`Failed to delete R2 object ${m.object_key}:`, err);
      }
    }
  }

  // 3. Batch delete database rows
  const statements = [
    env.DB.prepare('DELETE FROM post_media WHERE post_id = ?').bind(postId),
    env.DB.prepare('DELETE FROM post_reactions WHERE post_id = ?').bind(postId),
    env.DB.prepare('DELETE FROM comments WHERE post_id = ?').bind(postId),
  ];

  for (const m of mediaList) {
    statements.push(env.DB.prepare('DELETE FROM media WHERE id = ?').bind(m.id));
  }

  statements.push(env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(postId));

  await env.DB.batch(statements);
}
