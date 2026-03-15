import { ZodSchema } from "zod";
import { Request, Response, NextFunction } from "express";

/**
 * Express middleware factory that validates req.body against a Zod schema.
 * Returns 400 with flattened error details if validation fails.
 */
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res
        .status(400)
        .json({ error: "Validation failed", details: result.error.flatten() });
    }
    req.body = result.data;
    next();
  };
}
