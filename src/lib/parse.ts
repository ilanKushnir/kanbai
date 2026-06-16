import { z, type ZodType } from "zod";
import { HttpError } from "./api";
import { formatZodError } from "./validation";

export function parse<S extends ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpError(422, formatZodError(result.error), "validation_error");
  }
  return result.data;
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Invalid or missing JSON body");
  }
}
