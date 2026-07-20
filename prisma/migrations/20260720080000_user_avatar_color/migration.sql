-- Personal initials-avatar color (curated palette in src/lib/avatar-colors.ts).
-- NULL keeps the brand-default iris; image avatars are unaffected.
ALTER TABLE "User" ADD COLUMN "avatarColor" TEXT;
