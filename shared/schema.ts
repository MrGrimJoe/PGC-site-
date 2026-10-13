import { z } from 'zod';
import { USERNAME_REGEX } from './username.ts';

/**
 * Username schema:
 * - 3 to 20 characters
 * - Only lowercase letters, digits, and underscores
 */
export const usernameSchema = z
  .string()
  .min(3, { message: 'Username must be at least 3 characters long' })
  .max(20, { message: 'Username must be at most 20 characters long' })
  .regex(USERNAME_REGEX, {
    message: 'Username may only contain lowercase letters, numbers, and underscores',
  });

/**
 * Shared validation schema for PATCH /api/me
 */
export const updateProfileSchema = z
  .object({
    username: usernameSchema.optional(),
    display_name: z
      .string()
      .trim()
      .min(1, { message: 'Display name cannot be empty' })
      .max(50, { message: 'Display name must be at most 50 characters' })
      .optional(),
    bio: z
      .string()
      .max(500, { message: 'Bio must be at most 500 characters' })
      .optional(),
    avatar_media_id: z.string().nullable().optional(),
    dm_policy: z.enum(['everyone', 'following', 'none']).optional(),
    feed_preferences: z
      .union([z.string(), z.record(z.string(), z.unknown())])
      .optional(),
  })
  .strict();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Public user profile returned by GET /api/users/:username
 */
export interface PublicProfileResponse {
  username: string;
  display_name: string;
  bio: string;
  avatar_media_id: string | null;
  created_at: string;
}

/**
 * Authenticated user response returned by /api/me
 */
export interface MeResponse {
  user: {
    id: string;
    created_at: string;
    status: string;
  };
  profile: {
    username: string;
    username_normalized: string;
    display_name: string;
    bio: string;
    avatar_media_id: string | null;
  };
  settings: {
    dm_policy: string;
    feed_preferences: Record<string, unknown> | string;
  };
}
