import { db } from "@/lib/db";
import { slugify } from "./boards";

export async function uniqueWorkspaceSlug(base: string): Promise<string> {
  const root = slugify(base) || "workspace";
  let slug = root;
  let i = 1;
  while (await db.workspace.findUnique({ where: { slug } })) {
    i++;
    slug = `${root}-${i}`;
  }
  return slug;
}

/** Create a new workspace owned by the user (with an owner membership). */
export async function createWorkspaceForUser(userId: string, name: string) {
  const slug = await uniqueWorkspaceSlug(name);
  return db.workspace.create({
    data: {
      name,
      slug,
      ownerId: userId,
      members: { create: { userId, role: "owner" } },
    },
  });
}
